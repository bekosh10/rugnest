; Shulchan Kitim – Windows installer (built on Linux with makensis, no wine needed)
; makensis -DSRC=<win-unpacked> -DICON=<icon.ico> -DOUT=<setup.exe> -DVER=<n> installer.nsi
Unicode true
!include "MUI2.nsh"

Name "Shulchan Kitim"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\Shulchan Kitim"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_FINISHPAGE_RUN "$INSTDIR\Shulchan Kitim.exe"
!define MUI_FINISHPAGE_RUN_TEXT "לפתוח את שולחן קיטים"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Hebrew"

Section "install"
  nsExec::Exec 'taskkill /F /IM "Shulchan Kitim.exe"'
  Sleep 500
  RMDir /r "$INSTDIR"
  SetOutPath "$INSTDIR"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall Shulchan Kitim.exe"
  CreateShortCut "$DESKTOP\שולחן קיטים.lnk" "$INSTDIR\Shulchan Kitim.exe"
  CreateDirectory "$SMPROGRAMS\Shulchan Kitim"
  CreateShortCut "$SMPROGRAMS\Shulchan Kitim\שולחן קיטים.lnk" "$INSTDIR\Shulchan Kitim.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ShulchanKitim" "DisplayName" "שולחן קיטים (Shulchan Kitim)"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ShulchanKitim" "DisplayIcon" "$INSTDIR\Shulchan Kitim.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ShulchanKitim" "Publisher" "Campus"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ShulchanKitim" "DisplayVersion" "${VER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ShulchanKitim" "UninstallString" '"$INSTDIR\Uninstall Shulchan Kitim.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ShulchanKitim" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ShulchanKitim" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM "Shulchan Kitim.exe"'
  Sleep 500
  Delete "$DESKTOP\שולחן קיטים.lnk"
  RMDir /r "$SMPROGRAMS\Shulchan Kitim"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ShulchanKitim"
SectionEnd
