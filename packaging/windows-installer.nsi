# -*- coding: utf-8 -*-
Unicode true
RequestExecutionLevel admin
SetCompressor /SOLID lzma
Name "HromadaAID"
OutFile "${OUTPUT_FILE}"
InstallDir "$PROGRAMFILES64\HromadaAID"
InstallDirRegKey HKLM "Software\HromadaAID\Installer" "ProgramDirectory"
ShowInstDetails show
ShowUnInstDetails show

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!define MUI_CUSTOMFUNCTION_ABORT "HromadaAidRestoreServiceAfterAbort"
!ifndef CLIENT_PAYLOAD
  !error "CLIENT_PAYLOAD must point to the electron-builder win-unpacked directory"
!endif
!ifndef SERVER_PAYLOAD
  !error "SERVER_PAYLOAD must point to the staged Server component"
!endif
!ifndef PROJECT_DIR
  !error "PROJECT_DIR must point to the HromadaAID source tree"
!endif

Var Dialog
Var DataEdit
Var BackupEdit
Var DataDirectory
Var BackupDirectory
Var DisplayDataDirectory
Var DisplayBackupDirectory
Var InstallMode
Var ValidationMode

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
Page custom DataPage DataLeave "Серверні дані"
Page custom BackupPage BackupLeave "Резервні копії"
Page custom SummaryPage SummaryLeave "Перевірка параметрів"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "Ukrainian"

Section "Клієнт HromadaAID" SEC_CLIENT
  SetOutPath "$INSTDIR\Client"
  File /r "${CLIENT_PAYLOAD}\*"
  CreateShortcut "$SMPROGRAMS\HromadaAID.lnk" "$INSTDIR\Client\HromadaAID.exe"
  CreateShortcut "$DESKTOP\HromadaAID.lnk" "$INSTDIR\Client\HromadaAID.exe"
SectionEnd

Section "Сервер HromadaAID" SEC_SERVER
  ; Stop an existing instance before replacing its runtime or WinSW files.
  SetOutPath "$PLUGINSDIR"
  File /oname=windows-service-control.ps1 "${PROJECT_DIR}\packaging\windows-service-control.ps1"
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\windows-service-control.ps1" -Action stop-before-update -ProgramDirectory "$INSTDIR" -StateFile "$PLUGINSDIR\service-state.txt"' $1
  ${If} $1 != 0
    MessageBox MB_ICONSTOP|MB_OK "Не вдалося штатно зупинити попередню службу. Файли сервера не оновлено. Код: $1"
    Abort
  ${EndIf}
  SetOutPath "$INSTDIR\Server"
  File /r "${SERVER_PAYLOAD}\*"
SectionEnd

Section -PrepareServer
  SectionGetFlags ${SEC_SERVER} $0
  IntOp $0 $0 & ${SF_SELECTED}
  ${If} $0 != 0
    SetOutPath "$PLUGINSDIR"
    File /oname=prepare-server-install.mjs "${PROJECT_DIR}\packaging\prepare-server-install.mjs"
    File /oname=windows-installer-config.mjs "${PROJECT_DIR}\packaging\windows-installer-config.mjs"
    ExecWait '"$INSTDIR\Server\runtime\node.exe" "$PLUGINSDIR\prepare-server-install.mjs" --program-dir "$INSTDIR" --data-dir "$DataDirectory" --backup-dir "$BackupDirectory" --package-root "$INSTDIR\Server"' $1
    ${If} $1 != 0
      MessageBox MB_ICONSTOP|MB_OK "Не вдалося підготувати конфігурацію сервера. Каталоги та наявні дані залишено без видалення. Код: $1"
      Abort
    ${EndIf}
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\Server\installer\install-server-service.ps1" -ProgramDirectory "$INSTDIR" -DataDirectory "$DataDirectory" -BackupDirectory "$BackupDirectory" -PreviousServiceStateFile "$PLUGINSDIR\service-state.txt"' $1
    ${If} $1 != 0
      MessageBox MB_ICONSTOP|MB_OK "Не вдалося підготувати Windows Service. Наявні бази, ключі та резервні копії збережено. Перевірте права, диски, конфігурацію та журнали інсталятора. Код: $1"
      Abort
    ${EndIf}
    Delete "$PLUGINSDIR\service-state.txt"
    SectionGetFlags ${SEC_CLIENT} $0
    IntOp $0 $0 & ${SF_SELECTED}
    ${If} $0 != 0
      CreateDirectory "$INSTDIR\Client\resources"
      IfFileExists "$INSTDIR\Client\resources\server-connection.json" +3 0
      FileOpen $4 "$INSTDIR\Client\resources\server-connection.json" w
      FileWrite $4 '{"version":1,"apiUrl":"http://127.0.0.1:4310"}$\r$\n'
      FileClose $4
    ${EndIf}
  ${EndIf}
SectionEnd

Section -UninstallMetadata
  WriteRegStr HKLM "Software\HromadaAID\Installer" "ProgramDirectory" "$INSTDIR"
  SectionGetFlags ${SEC_SERVER} $0
  IntOp $0 $0 & ${SF_SELECTED}
  ${If} $0 != 0
    WriteRegStr HKLM "Software\HromadaAID\Installer" "DataDirectory" "$DataDirectory"
    WriteRegStr HKLM "Software\HromadaAID\Installer" "BackupDirectory" "$BackupDirectory"
  ${EndIf}
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  IfFileExists "$INSTDIR\Server\installer\windows-service-control.ps1" 0 unSkipServiceRemoval
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\Server\installer\windows-service-control.ps1" -Action uninstall -ProgramDirectory "$INSTDIR"' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "Не вдалося штатно зупинити або видалити службу HromadaAIDApi. Файли та дані залишено. Код: $0"
    Abort
  ${EndIf}
unSkipServiceRemoval:
  Delete "$SMPROGRAMS\HromadaAID.lnk"
  Delete "$DESKTOP\HromadaAID.lnk"
  RMDir /r "$INSTDIR\Client"
  RMDir /r "$INSTDIR\Server"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  ; Persistent server data, backups, DPAPI material, and path settings are intentionally preserved.
SectionEnd

Function .onInit
  SetRegView 64
  SetShellVarContext all
  ReadEnvStr $0 "ProgramData"
  ${If} $0 == ""
    ReadEnvStr $0 "SystemDrive"
    ${If} $0 == ""
      MessageBox MB_ICONSTOP|MB_OK "Не вдалося визначити системний каталог ProgramData."
      Abort
    ${EndIf}
    StrCpy $0 "$0\ProgramData"
  ${EndIf}
  StrCpy $DataDirectory "$0\HromadaAID\Data"
  StrCpy $BackupDirectory "$0\HromadaAID\Backups"
  SectionSetFlags ${SEC_CLIENT} ${SF_SELECTED}
  SectionSetFlags ${SEC_SERVER} 0
  ReadRegStr $0 HKLM "Software\HromadaAID\Installer" "DataDirectory"
  ${If} $0 != ""
    StrCpy $DataDirectory $0
  ${EndIf}
  ReadRegStr $0 HKLM "Software\HromadaAID\Installer" "BackupDirectory"
  ${If} $0 != ""
    StrCpy $BackupDirectory $0
  ${EndIf}
FunctionEnd

Function .onInstFailed
  IfFileExists "$PLUGINSDIR\windows-service-control.ps1" 0 installFailureDone
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\windows-service-control.ps1" -Action restore-after-failure -ProgramDirectory "$INSTDIR" -StateFile "$PLUGINSDIR\service-state.txt"' $0
installFailureDone:
FunctionEnd

Function HromadaAidRestoreServiceAfterAbort
  IfFileExists "$PLUGINSDIR\windows-service-control.ps1" 0 userAbortDone
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\windows-service-control.ps1" -Action restore-after-failure -ProgramDirectory "$INSTDIR" -StateFile "$PLUGINSDIR\service-state.txt"' $0
userAbortDone:
FunctionEnd

Function IsServerSelected
  SectionGetFlags ${SEC_SERVER} $0
  IntOp $0 $0 & ${SF_SELECTED}
  Push $0
FunctionEnd

Function DataPage
  Call IsServerSelected
  Pop $0
  ${If} $0 == 0
    Abort
  ${EndIf}
  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 32u "Каталог серверних даних міститиме SQLite, конфігурацію та журнали. Він зберігається окремо від програми."
  Pop $0
  ${NSD_CreateText} 0 42u 76% 14u "$DataDirectory"
  Pop $DataEdit
  ${NSD_CreateButton} 78% 42u 22% 14u "Огляд..."
  Pop $0
  ${NSD_OnClick} $0 BrowseData
  nsDialogs::Show
FunctionEnd

Function BrowseData
  nsDialogs::SelectFolderDialog "Каталог серверних даних" "$DataDirectory"
  Pop $0
  ${If} $0 != "error"
    ${NSD_SetText} $DataEdit "$0"
  ${EndIf}
FunctionEnd

Function DataLeave
  ${NSD_GetText} $DataEdit $DataDirectory
FunctionEnd

Function BackupPage
  Call IsServerSelected
  Pop $0
  ${If} $0 == 0
    Abort
  ${EndIf}
  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 32u "Каталог резервних копій міститиме зашифровані .hraid. Рекомендовано окремий постійний диск NTFS."
  Pop $0
  ${NSD_CreateText} 0 42u 76% 14u "$BackupDirectory"
  Pop $BackupEdit
  ${NSD_CreateButton} 78% 42u 22% 14u "Огляд..."
  Pop $0
  ${NSD_OnClick} $0 BrowseBackups
  nsDialogs::Show
FunctionEnd

Function BrowseBackups
  nsDialogs::SelectFolderDialog "Каталог резервних копій" "$BackupDirectory"
  Pop $0
  ${If} $0 != "error"
    ${NSD_SetText} $BackupEdit "$0"
  ${EndIf}
FunctionEnd

Function BackupLeave
  ${NSD_GetText} $BackupEdit $BackupDirectory
FunctionEnd

Function SummaryPage
  Call IsServerSelected
  Pop $0
  SectionGetFlags ${SEC_CLIENT} $1
  IntOp $1 $1 & ${SF_SELECTED}
  ${If} $0 == 0
    ${If} $1 == 0
      StrCpy $InstallMode "Не вибрано"
      StrCpy $DisplayDataDirectory "—"
      StrCpy $DisplayBackupDirectory "—"
    ${Else}
      StrCpy $InstallMode "Клієнт"
      StrCpy $DisplayDataDirectory "—"
      StrCpy $DisplayBackupDirectory "—"
    ${EndIf}
  ${Else}
    StrCpy $DisplayDataDirectory $DataDirectory
    StrCpy $DisplayBackupDirectory $BackupDirectory
    ${If} $1 == 0
      StrCpy $InstallMode "Сервер"
    ${Else}
      StrCpy $InstallMode "Сервер + клієнт"
    ${EndIf}
  ${EndIf}
  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 20u "Перевірте параметри встановлення."
  Pop $0
  ${NSD_CreateLabel} 0 26u 100% 18u "Режим: $InstallMode"
  Pop $0
  ${NSD_CreateLabel} 0 44u 100% 18u "Програма: $INSTDIR"
  Pop $0
  ${NSD_CreateLabel} 0 62u 100% 18u "Серверні дані: $DisplayDataDirectory"
  Pop $0
  ${NSD_CreateLabel} 0 80u 100% 18u "Резервні копії: $DisplayBackupDirectory"
  Pop $0
  nsDialogs::Show
FunctionEnd

Function SummaryLeave
  SectionGetFlags ${SEC_CLIENT} $0
  IntOp $0 $0 & ${SF_SELECTED}
  SectionGetFlags ${SEC_SERVER} $1
  IntOp $1 $1 & ${SF_SELECTED}
  ${If} $0 == 0
  ${AndIf} $1 == 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "Виберіть клієнт, сервер або обидва компоненти."
    Abort
  ${EndIf}
  ${If} $1 == 0
    StrCpy $ValidationMode "client"
  ${Else}
    ${If} $0 == 0
      StrCpy $ValidationMode "server"
    ${Else}
      StrCpy $ValidationMode "server-client"
    ${EndIf}
  ${EndIf}
  SetOutPath "$PLUGINSDIR"
  File /oname=windows-installer-paths.ps1 "${PROJECT_DIR}\packaging\windows-installer-paths.ps1"
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\windows-installer-paths.ps1" -Mode "$ValidationMode" -ProgramDirectory "$INSTDIR" -DataDirectory "$DataDirectory" -BackupDirectory "$BackupDirectory"' $2
  ${If} $2 != 0
    MessageBox MB_ICONSTOP|MB_OK "Перевірка каталогів не пройдена. Використайте окремі доступні локальні диски NTFS; каталоги не мають перекриватися, а наявні дані потребують сумісного server.json."
    Abort
  ${EndIf}
FunctionEnd
