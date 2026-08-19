# V6.16 — Bulk Upload Progress / Anti-Stuck

V6.15 submitted all selected CVs in one multipart request. With 20 PDF/DOCX
files this could appear stuck because one large request had to upload files,
write R2 objects, write D1 records, create applications, and audit every
candidate before returning a response.

V6.16 keeps the same file/folder UI but uploads each CV in its own request.
The UI shows `Uploading CV n/N: filename` and reports successful/failed files.

This avoids one giant multipart request and makes partial success possible.
No D1 schema changes are required.
