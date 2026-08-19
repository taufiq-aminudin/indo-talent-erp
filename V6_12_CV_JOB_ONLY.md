# V6.12 — CV + Job Only

Recruiter upload asks only for Job Position and CV.
Name, email, and phone are not requested from the recruiter.
The existing ERP `users` table requires a name/email, so the backend generates
non-contact internal values from the CV filename and a unique internal email.
No D1 schema changes or migrations are required.
