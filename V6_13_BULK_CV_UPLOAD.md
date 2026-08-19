# V6.13 — Bulk / Folder CV Upload

Fixed the V6.12 frontend syntax issue by rebuilding the candidate section cleanly.

Recruiters can now:
- select multiple CV files at once;
- select a folder containing CVs using `webkitdirectory`;
- upload up to 50 CVs per request;
- select one required open job position for the whole batch;
- upload PDF, DOCX, or TXT files;
- see uploaded/failed counts.

Name, email, and phone are not requested. The backend creates only internal
placeholder identity fields required by the existing ERP schema.

No D1 schema changes are required.
