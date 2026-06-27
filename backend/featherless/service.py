import os
import base64
import json
import logging
import time
import uuid
from typing import Dict, List, Tuple
import httpx
from gtts import gTTS
from dotenv import load_dotenv

load_dotenv()

# Setup logging
log_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "logs")
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, "featherless_errors.log")

# Configure a specific logger for featherless errors to avoid mixing with stdout/stderr
featherless_logger = logging.getLogger("featherless_errors")
featherless_logger.setLevel(logging.ERROR)
file_handler = logging.FileHandler(log_file)
formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
file_handler.setFormatter(formatter)
featherless_logger.addHandler(file_handler)

class FeatherlessService:
    def __init__(self):
        self.api_key = os.getenv("FEATHERLESS_API_KEY")
        self.base_url = os.getenv("FEATHERLESS_API_BASE", "https://api.featherless.ai/v1").rstrip("/")
        self.model = "Qwen/Qwen2.5-VL-7B-Instruct"

    def _sanitize_log_message(self, message: str) -> str:
        """Redacts API keys and sensitive info from logs."""
        if self.api_key:
            message = message.replace(self.api_key, "[REDACTED_API_KEY]")
        return message

    def extract_substances(self, image_base64: str) -> Tuple[List[str], float, bool]:
        """
        Sends base64 image to Qwen2.5-VL-7B-Instruct on Featherless AI to extract ingredients.
        Returns:
            substances (list): Extracted substance names.
            confidence (float): Confidence score between 0 and 1.
            error_occurred (bool): True if API failed or timed out.
        """
        if not self.api_key:
            err_msg = "FEATHERLESS_API_KEY is not configured."
            featherless_logger.error(err_msg)
            return [], 0.0, True

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        # vision model query structure
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Extract all active chemical substances, heavy metals, contaminants, or ingredients "
                                "listed on this fertilizer label. Return a JSON object with two keys: "
                                "'substances' (a list of clean, singular English names of the chemical substances found, e.g., ['Cadmium', 'Phosphonates']) "
                                "and 'confidence' (a float between 0 and 1 representing your confidence in this extraction based on image clarity). "
                                "Output ONLY valid JSON. Do not include markdown code block syntax."
                            )
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_base64}"
                            }
                        }
                    ]
                }
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.0
        }

        url = f"{self.base_url}/chat/completions"
        start_time = time.time()

        try:
            # 30 seconds timeout limit as per requirements
            with httpx.Client(timeout=30.0) as client:
                response = client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                response_json = response.json()
                
                content = response_json["choices"][0]["message"]["content"]
                data = json.loads(content)
                
                substances = data.get("substances", [])
                confidence = float(data.get("confidence", 0.0))
                
                # Normalize substance names to title case
                substances = [s.strip().capitalize() for s in substances if s.strip()]
                
                return substances, confidence, False

        except httpx.TimeoutException as e:
            err_msg = f"Featherless API timeout after {time.time() - start_time:.2f}s."
            featherless_logger.error(self._sanitize_log_message(err_msg))
            return [], 0.0, True
            
        except Exception as e:
            err_msg = f"Featherless API error: {str(e)}"
            featherless_logger.error(self._sanitize_log_message(err_msg))
            return [], 0.0, True

    def generate_tts_warning(self, risk_level: str, substances: List[str], language: str) -> str:
        """
        Synthesizes a voice warning file based on the risk level and substances, in Swahili or Kikuyu.
        Returns:
            voice_url (str): Path to the generated static MP3 file.
        """
        language = language.lower().strip()
        static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "audio")
        os.makedirs(static_dir, exist_ok=True)
        
        filename = f"warning_{uuid.uuid4().hex}.mp3"
        filepath = os.path.join(static_dir, filename)

        # Formulate text based on language and risk
        if language == "ki":  # Kikuyu
            if risk_level == "HIGH":
                substances_str = ", ".join(substances)
                text = (
                    f"Mukanio wa ugwati. Mbolea ĩno nĩ yarĩ na ugwati nĩ ũndũ wa kũgĩa na {substances_str}. "
                    "Ndũkaĩhũthĩre mĩgũnda-inĩ yaku nĩguo mĩgũnda yaku ĩtikegetwo na nja. Hũthĩra mbadala cia kĩndũ kĩega."
                )
            else:
                text = "Mbolea ĩno nĩ thĩnĩ na nĩ ya kwĩhoka. No ũhũthĩre mĩgũnda-inĩ yaku."
        else:  # Default to Swahili (sw)
            if risk_level == "HIGH":
                substances_str = ", ".join(substances)
                text = (
                    f"Onyo la hatari. Mbolea hii ina viungo hatari vya {substances_str} ambavyo vimepigwa marufuku katika soko la Ulaya. "
                    "Tafadhali usitumie mbolea hii ili kuzuia mazao yako kukataliwa. Tumia mbadala salama."
                )
            else:
                text = "Mbolea hii iko salama na inakubalika kwa mauzo ya nje. Unaweza kuitumia."

        try:
            # Generate TTS audio
            # gTTS only supports 'sw' natively, so for Kikuyu ('ki') we read the Kikuyu text using Swahili pronunciation
            # which works reasonably well as a hybrid approach for a MVP demo, or fallback.
            lang_code = "sw"
            tts = gTTS(text=text, lang=lang_code, slow=False)
            tts.save(filepath)
            
            # Return static file URL path
            return f"/static/audio/{filename}"
            
        except Exception as e:
            err_msg = f"TTS Audio generation failed: {str(e)}"
            featherless_logger.error(self._sanitize_log_message(err_msg))
            # Return a default warning path or fallback
            return "/static/audio/default_warning.mp3"
