# V6.27 — OpenAI CV Extraction Fix

Built from V6.26.

Fixes:
1. Sends Responses API `input_file.file_data` as the base64-encoded file content,
   rather than a data-URL wrapper.
2. Keeps the current `gpt-5.6-luna` default, which is a current OpenAI API model.
3. Exposes the upstream OpenAI HTTP status and truncated error body in the
   Worker response, so quota/model/file errors are diagnosable.
4. Extraction endpoint preserves 429/4xx/5xx upstream status where appropriate.
5. AI Screening refuses to run when the CV has not been extracted, returning
   `cv_not_extracted` instead of a misleading generic AI failure.
6. Login, session, D1, R2, upload, bulk upload and professional UI are preserved.

OpenAI Responses API supports file inputs with `input_file` and base64 `file_data`.
