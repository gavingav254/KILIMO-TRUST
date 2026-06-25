```markdown
#  Kilimo Trust: Protecting Smallholder Income from Hidden Fertilizer Risks

> **"Piga picha au sema, jua hatari kabla ya kutumia."**  
> *(Scan or speak — know the risk before you apply.)*

**Kilimo Trust** is a voice-first, offline-capable Progressive Web App (PWA) built for the **Kenya AI Challenge - AgriFin Track**. It empowers smallholder farmers to verify fertilizer compliance with EU export regulations *before* application, preventing harvest rejection, securing income, and ensuring loan repayment.

##  Live Demo & Resources
*   **📱 Live App:** [Insert Lovable App Link Here]
*   **📊 Pitch Deck:** [Insert Pitch Deck Link Here]
*   **🎥 Video Demo:** [Insert Video Link Here]

##  The Problem
Smallholder organic farmers in Kenya risk total harvest rejection at EU borders due to hidden contaminants (e.g., Cadmium, Phosphonates) in locally available fertilizers. 
*   **Literacy Barrier:** Farmers cannot read technical chemical names on labels.
*   **Financial Risk:** Rejected crops lead to lost income → loan defaults → broken value chains.
*   **Invisibility:** The risk is hidden until it’s too late (at the border).

##  The Solution
Kilimo Trust allows farmers to:
1.  **Scan** a fertilizer label via camera or **Speak** the name.
2.  **Analyze** ingredients against EU Regulations (Reg 2019/1009, 2023/915) using a Knowledge Graph.
3.  **Receive** instant, plain-language voice advice in Swahili, Kikuyu, Dholuo, or Kalenjin.
4.  **Build** an "Export Ready Score" that improves their creditworthiness with SACCOs.

---

## 🛠️ Tech Stack (Mandatory AgriFin Stack)

| Technology | Role in Kilimo Trust |
| :--- | :--- |
| **Neo4j** | **The Brain.** Stores complex relationships between `Substances`, `EU_Regulations`, `Risk_Levels`, and `Safe_Alternatives`. Enables dynamic risk querying. |
| **Featherless AI** | **The Senses.** Handles OCR (extracting text from dirty labels), NLP (translating jargon to plain language), and TTS (generating vernacular voice notes). |
| **Masumi** | **The Orchestrator.** Manages the workflow, calculates risk scores, and escalates uncertain cases to human experts. |
| **Lovable** | **The Face.** Builds the responsive, accessible, voice-first PWA interface optimized for low-end smartphones. |

## 🏗️ Architecture

```mermaid
graph TD
    A[Farmer Phone (Lovable PWA)] -->|Photo/Voice Input| B(Featherless AI)
    B -->|Extracted Text| C{Masumi Agent}
    C -->|Query Substance| D[(Neo4j Graph DB)]
    D -->|Risk Level + Advice| C
    C -->|Generate Voice Note| B
    B -->|Audio URL + Risk Card| A
    A -->|Display Result| E[Farmer]
```

### Key Features
*   **Offline-First:** Caches top 20 fertilizer profiles and voice files for use in remote areas.
*   **Accessibility:** High-contrast UI, large touch targets, and full voice readout for PWDs.
*   **AgriFin Integration:** Updates farmer "Export Ready Score" based on safe input usage.
*   **Data Sources:** Integrates insights from **CABI BioProtection Portal**, **iSDAsoil**, **LSC Hub**, and **EU Legislation**.

---

## ⚙️ Installation & Setup

### Prerequisites
*   Node.js & npm
*   Neo4j AuraDB Account (Free Tier)
*   Featherless API Key

### 1. Clone the Repository
```bash
git clone https://github.com/gavingav254/kilimo-trust.git
cd kilimo-trust
```

### 2. Backend Setup (Neo4j & API)
*   Create a `.env` file in the root directory.
*   Add your credentials:
    ```env
    NEO4J_URI=bolt://your-uri.neo4jsandbox.com
    NEO4J_USER=neo4j
    NEO4J_PASSWORD=your-password
    FEATHERLESS_API_KEY=your-api-key
    ```
*   Import the initial data schema from `data/initial_graph.csv` into Neo4j. This data maps substances like Cadmium to EU Regulation 2019/1009 limits.

### 3. Frontend Setup (Lovable)
*   The frontend is hosted on Lovable. To run locally for development:
    ```bash
    cd frontend
    npm install
    npm run dev
    ```

### 4. Running the Prototype
*   Open the Lovable app link.
*   Select Language (e.g., Swahili).
*   Click "Scan Label" or "Speak Name".
*   Observe the risk assessment and listen to the voice advisory.

---

##  Team Kilimo Trust

| Name | Role | Contribution |
| :--- | :--- | :--- |
| **Gavin Chesebe** | Product Lead / AgriFin Expert | Defined EU regulation mapping, Neo4j schema, and AgriFin impact logic. |
| **Ephey Nyaga** | AI Automation Engineer | Built Featherless OCR/TTS pipeline and API integration. |
| **Wendy Okoth** | Prototype Builder | Connected Lovable frontend to Neo4j backend and implemented risk logic. |
| **Brian Chacha** | Prototype Builder | Implemented Masumi agent escalation and offline caching service workers. |
| **Rodgers Abraham** | UI/UX Designer | Designed accessible, voice-first PWA interface and lender dashboard mockups. |

---

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
