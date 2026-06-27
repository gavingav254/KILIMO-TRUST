import logging
from typing import Dict, List, Optional, Tuple
from backend.featherless.service import FeatherlessService
from backend.neo4j_client import Neo4jClient

logger = logging.getLogger(__name__)

class MasumiOrchestrator:
    def __init__(self, featherless_service: FeatherlessService, neo4j_client: Neo4jClient):
        self.featherless_service = featherless_service
        self.neo4j_client = neo4j_client

    def calculate_export_ready_score(self, substances_details: List[Dict]) -> int:
        """
        Calculates the Export Ready Score (0 - 100).
        - Start with 100.
        - Deduct 45 points for each HIGH risk regulated substance.
        - Deduct 15 points for each MEDIUM risk substance.
        - Cap the minimum score at 0.
        """
        score = 100
        for details in substances_details:
            risk_level = details.get("risk_level", "LOW").upper()
            regulated = details.get("regulated", False)
            
            if risk_level == "HIGH" and regulated:
                score -= 45
            elif risk_level == "HIGH":
                score -= 30
            elif risk_level == "MEDIUM":
                score -= 15
                
        return max(0, min(100, score))

    def check_risk_from_image(self, image_base64: str, language: str = "sw") -> Dict:
        """
        Processes a raw label image through OCR -> Neo4j -> TTS pipeline.
        Escalates to manual review if OCR confidence is < 70%.
        """
        # Run OCR
        substances, confidence, error_occurred = self.featherless_service.extract_substances(image_base64)
        
        if error_occurred:
            return {
                "manual_entry_required": True,
                "error": "OCR service timeout or failure. Please enter ingredients manually.",
                "substances": [],
                "risk_level": "UNKNOWN",
                "verdict": "OCR process failed due to server timeout or error. Escalating to expert review.",
                "voice_url": None,
                "export_ready_score": 0,
                "substance_details": []
            }

        # Check OCR confidence threshold
        if confidence < 0.70:
            logger.info(f"Low OCR confidence ({confidence:.2f} < 0.70). Escalating to manual review.")
            return {
                "manual_entry_required": True,
                "substances": [],
                "risk_level": "UNKNOWN",
                "verdict": f"Sura haieleweki vizuri (Uaminifu: {confidence*100:.0f}%). Tafadhali weka viungo kwa mikono au subiri Masumi akague.",
                "voice_url": None,
                "export_ready_score": 0,
                "substance_details": []
            }

        # If confidence is high, evaluate substances
        return self.check_risk_from_substances(substances, language)

    def check_risk_from_substances(self, substances: List[str], language: str = "sw") -> Dict:
        """
        Processes a clean list of substances through Neo4j -> TTS pipeline.
        """
        substances_details = []
        overall_risk = "LOW"
        high_risk_substances = []

        # Check each substance against Neo4j regulations
        for sub in substances:
            details = self.neo4j_client.check_substance(sub)
            substances_details.append(details)
            
            # Aggregate risk levels
            if details.get("risk_level", "LOW").upper() == "HIGH":
                overall_risk = "HIGH"
                high_risk_substances.append(details.get("substance"))
            elif details.get("risk_level", "LOW").upper() == "MEDIUM" and overall_risk != "HIGH":
                overall_risk = "MEDIUM"

        # Calculate credit readiness score
        export_ready_score = self.calculate_export_ready_score(substances_details)

        # Build verdict explanation
        language = language.lower().strip()
        if language == "ki":  # Kikuyu
            if overall_risk == "HIGH":
                subs_list = ", ".join(high_risk_substances)
                verdict = (
                    f"Onyo: Mbolea ĩno nĩ yarĩ na ugwati nĩ ũndũ wa kũgĩa na {subs_list}. "
                    "Ndĩ kũrehe ugwati wa kũgĩto mauzo maku na nja na gũthũkia Export Ready Score yaku."
                )
            else:
                verdict = "Mbolea ĩno nĩ njega na nĩ ya kwĩhoka gũhũthĩra mĩgũnda-inĩ yaku."
        else:  # Swahili
            if overall_risk == "HIGH":
                subs_list = ", ".join(high_risk_substances)
                verdict = (
                    f"Onyo: Mbolea hii ina viungo hatari vya {subs_list} ambavyo havikubaliki kwa mauzo ya nje ya EU. "
                    f"Hii itaharibu kiwango chako cha mikopo (Export Ready Score sasa ni {export_ready_score})."
                )
            else:
                verdict = "Mbolea hii iko salama kwa mazao ya mauzo ya nje. Hakuna hatari zilizopatikana."

        # Generate TTS audio warning
        voice_url = self.featherless_service.generate_tts_warning(
            risk_level=overall_risk,
            substances=high_risk_substances if high_risk_substances else substances,
            language=language
        )

        return {
            "manual_entry_required": False,
            "substances": substances,
            "risk_level": overall_risk,
            "verdict": verdict,
            "voice_url": voice_url,
            "export_ready_score": export_ready_score,
            "substance_details": substances_details
        }
