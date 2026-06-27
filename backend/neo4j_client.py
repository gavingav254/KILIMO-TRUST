import os
import logging
from typing import Dict, List, Optional
from neo4j import GraphDatabase, Driver
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# Core fallbacks in case Neo4j is offline
FALLBACK_SUBSTANCES = {
    "cadmium": {
        "substance": "Cadmium",
        "regulated": True,
        "regulation": "Regulation (EU) 2019/1009",
        "limit": "0.02 mg/kg",
        "risk_level": "HIGH",
        "alternatives": ["Organic Compost", "Bio-fertilizers"]
    },
    "phosphonates": {
        "substance": "Phosphonates",
        "regulated": True,
        "regulation": "Regulation (EU) 2023/915",
        "limit": "0.5 mg/kg",
        "risk_level": "HIGH",
        "alternatives": ["Rock Phosphate", "Bone Meal"]
    },
    "lead": {
        "substance": "Lead",
        "regulated": True,
        "regulation": "Regulation (EU) 2019/1009",
        "limit": "0.1 mg/kg",
        "risk_level": "HIGH",
        "alternatives": ["Compost", "Bio-fertilizers"]
    },
    "mercury": {
        "substance": "Mercury",
        "regulated": True,
        "regulation": "Regulation (EU) 2019/1009",
        "limit": "0.01 mg/kg",
        "risk_level": "HIGH",
        "alternatives": ["Bio-organic amendments"]
    },
    "arsenic": {
        "substance": "Arsenic",
        "regulated": True,
        "regulation": "Regulation (EU) 2019/1009",
        "limit": "0.03 mg/kg",
        "risk_level": "HIGH",
        "alternatives": ["Natural composts"]
    },
    "nitrogen": {
        "substance": "Nitrogen",
        "regulated": False,
        "regulation": None,
        "limit": None,
        "risk_level": "LOW",
        "alternatives": []
    },
    "potassium": {
        "substance": "Potassium",
        "regulated": False,
        "regulation": None,
        "limit": None,
        "risk_level": "LOW",
        "alternatives": []
    },
    "phosphorus": {
        "substance": "Phosphorus",
        "regulated": False,
        "regulation": None,
        "limit": None,
        "risk_level": "LOW",
        "alternatives": []
    }
}

class Neo4jClient:
    def __init__(self):
        self.uri = os.getenv("NEO4J_URI")
        self.user = os.getenv("NEO4J_USER")
        self.password = os.getenv("NEO4J_PASSWORD")
        self.driver: Optional[Driver] = None
        
        if self.uri and self.user and self.password:
            try:
                # Connection timeout set to 5 seconds to prevent hanging
                self.driver = GraphDatabase.driver(
                    self.uri, 
                    auth=(self.user, self.password),
                    connection_timeout=5.0
                )
                logger.info("Neo4j driver initialized successfully.")
            except Exception as e:
                logger.error(f"Failed to initialize Neo4j driver: {e}. Falling back to local catalog.")
        else:
            logger.warning("Neo4j credentials not fully provided. Running in OFFLINE/FALLBACK mode.")

    def close(self):
        if self.driver:
            self.driver.close()

    def check_substance(self, substance_name: str) -> Dict:
        """
        Check substance details against Neo4j regulations, or fallback to offline catalog.
        """
        clean_name = substance_name.strip().lower()
        
        # If driver exists, attempt real DB query
        if self.driver:
            try:
                with self.driver.session() as session:
                    # Case-insensitive check
                    query = """
                    MATCH (s:Substance)
                    WHERE toLower(s.name) = toLower($name)
                    OPTIONAL MATCH (s)-[:REGULATED_BY]->(r:EU_Regulation)
                    OPTIONAL MATCH (s)-[:HAS_RISK]->(rl:Risk_Level)
                    OPTIONAL MATCH (s)-[:HAS_ALTERNATIVE]->(a:Safe_Alternative)
                    RETURN s.name AS substance, 
                           r.name AS regulation, 
                           r.limit AS limit, 
                           rl.level AS risk_level, 
                           collect(a.name) AS alternatives
                    """
                    result = session.run(query, name=clean_name)
                    record = result.single()
                    
                    if record:
                        # Extract and format response
                        substance = record.get("substance") or substance_name
                        regulation = record.get("regulation")
                        limit = record.get("limit")
                        risk_level = record.get("risk_level") or "LOW"
                        alternatives = record.get("alternatives") or []
                        
                        return {
                            "substance": substance,
                            "regulated": bool(regulation),
                            "regulation": regulation,
                            "limit": limit,
                            "risk_level": risk_level,
                            "alternatives": list(alternatives)
                        }
            except Exception as e:
                logger.error(f"Neo4j query error: {e}. Falling back to local catalog for '{substance_name}'.")

        # Fallback to local dictionary
        fallback_data = FALLBACK_SUBSTANCES.get(clean_name)
        if fallback_data:
            return fallback_data
            
        # Default response for unknown/non-regulated substances
        return {
            "substance": substance_name,
            "regulated": False,
            "regulation": None,
            "limit": None,
            "risk_level": "LOW",
            "alternatives": []
        }
