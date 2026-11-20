; Tamnun Signs – Windows installer (built on Linux with makensis, no wine needed)
; makensis -DSRC=<win-unpacked> -DICON=<icon.ico> -DOUT=<setup.exe> -DVER=<n> installer.nsi
Unicode true
!include "MUI2.nsh"

Name "Tamnun Signs"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\Tamnun Signs"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_FINISHPAGE_RUN "$INSTDIR\Tamnun Signs.exe"
!define MUI_FINISHPAGE_RUN_TEXT "לפתוח את Tamnun Signs"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Hebrew"

Section "install"
  ; close a running copy before replacing files
  nsExec::Exec 'taskkill /F /IM "Tamnun Signs.exe"'
  Sleep 500
  RMDir /r "$INSTDIR"
  SetOutPath "$INSTDIR"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall Tamnun Signs.exe"
  CreateShortCut "$DESKTOP\Tamnun Signs.lnk" "$INSTDIR\Tamnun Signs.exe"
  CreateDirectory "$SMPROGRAMS\Tamnun Signs"
  CreateShortCut "$SMPROGRAMS\Tamnun Signs\Tamnun Signs.lnk" "$INSTDIR\Tamnun Signs.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TamnunSigns" "DisplayName" "Tamnun Signs"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TamnunSigns" "DisplayIcon" "$INSTDIR\Tamnun Signs.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TamnunSigns" "Publisher" "Campus"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TamnunSigns" "DisplayVersion" "${VER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TamnunSigns" "UninstallString" '"$INSTDIR\Uninstall Tamnun Signs.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TamnunSigns" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TamnunSigns" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM "Tamnun Signs.exe"'
  Sleep 500
  Delete "$DESKTOP\Tamnun Signs.lnk"
  RMDir /r "$SMPROGRAMS\Tamnun Signs"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TamnunSigns"
SectionEnd
