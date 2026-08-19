# V6.6 Password/Login Fix

Fixed a V6.5 compatibility bug:
- PBKDF2 digest was calculated with 100,000 iterations but the stored hash label still said 120,000.
- New hashes now store `pbkdf2$100000$...`.
- Verification caps iterations at 100,000 so accounts created by V6.5 can still log in.

No database schema changes are required.
