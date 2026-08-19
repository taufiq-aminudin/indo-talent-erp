# V6.14 — Bulk CV Build Fix

V6.13 failed because two newly added browser-JavaScript template literals
were embedded inside the Worker's outer HTML template literal.

V6.14 replaces those two nested templates with string concatenation.
Bulk and folder CV upload remains unchanged.

No D1 schema changes or migrations are required.
