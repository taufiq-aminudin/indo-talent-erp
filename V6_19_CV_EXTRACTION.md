# V6.19 — CV Extraction

Based directly on V6.18.

Adds:
- Extract CV action for each application.
- Reads the existing CV object from Cloudflare R2.
- Sends the PDF/DOCX/TXT file to the OpenAI Responses API as an input file.
- Extracts job-relevant structured fields only.
- Stores education, experience_years, current_position, skills, languages,
  headline and summary in the existing candidate_profiles columns.
- Does not extract/store email, phone, address, national ID, gender, religion,
  race, marital status, photo details, or other protected/sensitive traits.
- AI screening then uses the extracted profile.

The API key remains server-side as OPENAI_API_KEY. No D1 schema changes.
