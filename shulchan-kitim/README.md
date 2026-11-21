# שולחן קיטים (Shulchan Kitim)

תוכנה (Windows / Mac) לסידור קיטים על גיליון, ולחיתוך וערימה בכמויות שונות.

- `index.html` + `version.json` – הדף שהתוכנה מורידה בכפתור "יש גרסה חדשה – לעדכן". בכל גרסה מעלים את המספר גם ב-`version.json` וגם ב-`APP_VERSION` בקוד.
- המקור הוא הארטיפקט `shulchan-kitim.html`. `tools/make-page.py <artifact.html> index.html` מחליף את ספריות ה-PDF מהאינטרנט לתיקיית `lib/` של התוכנה.
- `desktop/` – מעטפת Electron. בבנייה מעתיקים את `index.html` ו-`version.json` אל `desktop/app/`.

## בנייה (בלינוקס)
- Windows: `npx electron-builder --win --x64` ← `node seticon.mjs "dist/win-unpacked/Shulchan Kitim.exe" build/icon.ico` ← `makensis -DSRC=… -DICON=build/icon.ico -DOUT=shulchan-kitim-setup.exe -DVER=<n> installer.nsi`.
- Mac Apple Silicon: `npx electron-builder --mac --arm64 -c.mac.extendInfo.LSMinimumSystemVersion=11.0` ← `rcodesign sign "Shulchan Kitim.app"` ← `zip -qry`.
- Mac Intel (מק ישן): `npx electron-builder --mac --x64 -c.electronVersion=26.6.10 -c.mac.extendInfo.LSMinimumSystemVersion=10.13` ← `rcodesign sign` ← `zip -qry`. Electron 26 כדי שירוץ גם על macOS 10.13 ומעלה.
- שינוי ב-`main.js` או ב-`preload.js` מחייב קובץ התקנה חדש. שינוי רק בדף מגיע בכפתור העדכון.
