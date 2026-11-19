# Urbanica Magnet

אפליקציית מק לשינוי שמות קבצי מגנטים של אורבניקה לפי מבנה התיקיות.

- `index.html` + `version.json` – הדף שהאפליקציה מורידה בלחיצה על "עדכון". בכל גרסה מעלים את המספר גם ב-`version.json` וגם ב-`APP_VERSION` בקוד.
- `desktop/` – מעטפת Electron. בבנייה מעתיקים את `index.html` ו-`version.json` אל `desktop/app/`.
