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
!define MUI_CUSTOMFUNCTION_ABORT "HromadaAidRestoreServiceAfterAbort"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\HromadaAID"
!ifndef CLIENT_PAYLOAD
  !error "CLIENT_PAYLOAD must point to the electron-builder win-unpacked directory"
!endif
!ifndef SERVER_PAYLOAD
  !error "SERVER_PAYLOAD must point to the staged Server component"
!endif
!ifndef MANAGER_PAYLOAD
  !error "MANAGER_PAYLOAD must point to the staged Server Manager component"
!endif
!ifndef PROJECT_DIR
  !error "PROJECT_DIR must point to the HromadaAID source tree"
!endif
!ifndef CLIENT_PAYLOAD_BYTES
  !error "CLIENT_PAYLOAD_BYTES must be emitted from package-manifest.json"
!endif
!ifndef SERVER_PAYLOAD_BYTES
  !error "SERVER_PAYLOAD_BYTES must be emitted from package-manifest.json"
!endif
!ifndef INSTALLER_SUPPORT_BYTES
  !error "INSTALLER_SUPPORT_BYTES must be emitted from package-manifest.json"
!endif
!ifndef MANAGER_PAYLOAD_BYTES
  !error "MANAGER_PAYLOAD_BYTES must describe the Server Manager payload"
!endif
!ifndef APP_VERSION
  !error "APP_VERSION must come from package-manifest.json"
!endif
!ifndef MANAGER_BRANDING_ID
  !error "MANAGER_BRANDING_ID must come from the packaged manager-version.ini"
!endif

Var DataDirectory
Var BackupDirectory
Var PreflightProgramDirectory
Var PreflightDataDirectory
Var PreflightBackupDirectory
Var ValidationMode
Var ManagerVersion
Var ManagerBranding

!define MUI_ICON "${PROJECT_DIR}\assets\hromadaaid.ico"
!define MUI_UNICON "${PROJECT_DIR}\assets\hromadaaid.ico"

; Both installer and uninstaller use the same four exact, target-checked links.
; Isolate PowerShell Add-Type from native NSIS plugin DLLs in PLUGINSDIR.
!macro SyncApplicationShortcuts CLIENT_SELECTED MANAGER_SELECTED
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\WindowsIntegration"
  File /oname=windows-shortcuts.ps1 "${PROJECT_DIR}\packaging\windows-shortcuts.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\WindowsIntegration\windows-shortcuts.ps1" -ProgramDirectory "$INSTDIR" -ClientSelected ${CLIENT_SELECTED} -ManagerSelected ${MANAGER_SELECTED}'
  Pop $2
  Pop $3
  DetailPrint "$3"
  ${If} $2 != 0
    MessageBox MB_ICONSTOP|MB_OK "Не вдалося налаштувати ярлики HromadaAID. Програмні файли й дані збережено. Повторіть операцію після перевірки доступу до спільних каталогів ярликів."
    Abort
  ${EndIf}
!macroend

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE SummaryLeave
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "Ukrainian"

Section -CloseApplications
  ; taskkill without /F sends the normal close request; Windows file-copy errors
  ; remain fatal if an application cannot close cleanly.
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM HromadaAID.exe /T'
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM "HromadaAID Server Manager.exe" /T'
  Sleep 500
SectionEnd

Section -ProductBranding
  ; Always available for Installed Apps, including Server-only.
  SetOutPath "$INSTDIR\assets"
  File /oname=hromadaaid.ico "${PROJECT_DIR}\assets\hromadaaid.ico"
SectionEnd

Section "Клієнт HromadaAID" SEC_CLIENT
  SetOutPath "$INSTDIR\Client"
  File /r "${CLIENT_PAYLOAD}\*"
SectionEnd

Section "API Server + Server Manager (обов’язковий комплект)" SEC_SERVER
  ; Refuse inconsistent server layouts before replacing even the Manager files.
  IfFileExists "$INSTDIR\Server\service\HromadaAIDService.exe" serverLayoutValid
  IfFileExists "$INSTDIR\Server\*.*" partialServerInstall
  IfFileExists "$INSTDIR\Server.next\package-integrity.json" serverLayoutValid
  IfFileExists "$INSTDIR\Server.next\*.*" partialServerInstall
  IfFileExists "$INSTDIR\ServerManager\HromadaAID Server Manager.exe" partialServerInstall
serverLayoutValid:
  ; Reuse an unchanged Manager, but deliver a new icon even at the same SemVer.
  StrCpy $ManagerVersion ""
  StrCpy $ManagerBranding ""
  ReadINIStr $ManagerVersion "$INSTDIR\ServerManager\resources\manager-version.ini" "manager" "version"
  ReadINIStr $ManagerBranding "$INSTDIR\ServerManager\resources\manager-version.ini" "manager" "brandingId"
  ${If} $ManagerVersion == "${APP_VERSION}"
  ${AndIf} $ManagerBranding == "${MANAGER_BRANDING_ID}"
    IfFileExists "$INSTDIR\ServerManager\HromadaAID Server Manager.exe" managerExecutablePresent managerNeedsCopy
managerExecutablePresent:
    IfFileExists "$INSTDIR\ServerManager\resources\app.asar" managerCopyDone managerNeedsCopy
  ${Else}
    Goto managerNeedsCopy
  ${EndIf}
managerNeedsCopy:
  RMDir /r "$INSTDIR\ServerManager"
  SetOutPath "$INSTDIR\ServerManager"
  File /r "${MANAGER_PAYLOAD}\*"
managerCopyDone:

  ; A clean setup stages the verified payload. First configuration and service
  ; registration then run through the existing Server Manager wizard.
  IfFileExists "$INSTDIR\Server\service\HromadaAIDService.exe" updateExistingServer 0
  IfFileExists "$INSTDIR\Server\*.*" partialServerInstall 0
  IfFileExists "$INSTDIR\Server.next\package-integrity.json" keepExistingStage 0
  IfFileExists "$INSTDIR\Server.next\*.*" partialServerInstall 0
  SetOutPath "$INSTDIR\Server.next"
  File /r "${SERVER_PAYLOAD}\*"
  Goto serverSectionDone
keepExistingStage:
  DetailPrint "Наявний Server.next збережено для безпечного продовження у Server Manager."
  Goto serverSectionDone
partialServerInstall:
  MessageBox MB_ICONSTOP|MB_OK "Знайдено часткову інсталяцію сервера без підтвердженої служби або повного Server.next. Файли не перезаписано; перевірте стан через Server Manager."
  Abort
updateExistingServer:
  SetOutPath "$PLUGINSDIR"
  File /oname=windows-service-control.ps1 "${PROJECT_DIR}\packaging\windows-service-control.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\windows-service-control.ps1" -Action stop-before-update -ProgramDirectory "$INSTDIR" -StateFile "$PLUGINSDIR\service-state.txt" -UpdateJournalPath "$DataDirectory\.hromadaaid-update-state.json"'
  Pop $1
  Pop $3
  ${If} $1 != 0
    MessageBox MB_ICONSTOP|MB_OK "Не вдалося безпечно підготувати оновлення API Server. Чинні файли та дані не змінено. Код: $1"
    Abort
  ${EndIf}
  SetOutPath "$INSTDIR\Server.next"
  File /r "${SERVER_PAYLOAD}\*"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\Server.next\installer\install-server-service.ps1" -ProgramDirectory "$INSTDIR" -DataDirectory "$DataDirectory" -BackupDirectory "$BackupDirectory" -PreviousServiceStateFile "$PLUGINSDIR\service-state.txt" -UpdateOnly'
  Pop $1
  Pop $3
  ${If} $1 != 0
    MessageBox MB_ICONSTOP|MB_OK "Оновлення API Server не завершено. Перевірте стан у Server Manager; серверні дані не видалялися. Код: $1"
    Abort
  ${EndIf}
serverSectionDone:
SectionEnd

Section -RemoveDeselected
  SectionGetFlags ${SEC_CLIENT} $0
  IntOp $0 $0 & ${SF_SELECTED}
  ${If} $0 == 0
    RMDir /r "$INSTDIR\Client"
  ${EndIf}
  SectionGetFlags ${SEC_SERVER} $0
  IntOp $0 $0 & ${SF_SELECTED}
  ${If} $0 == 0
    Call RemoveServerComponent
  ${EndIf}
SectionEnd

Section -ApplicationShortcuts
  SectionGetFlags ${SEC_CLIENT} $0
  IntOp $0 $0 & ${SF_SELECTED}
  SectionGetFlags ${SEC_SERVER} $1
  IntOp $1 $1 & ${SF_SELECTED}
  !insertmacro SyncApplicationShortcuts $0 $1
SectionEnd

Section -UninstallMetadata
  WriteRegStr HKLM "Software\HromadaAID\Installer" "ProgramDirectory" "$INSTDIR"
  WriteRegStr HKLM "Software\HromadaAID\Installer" "InstallVersion" "${APP_VERSION}"
  SectionGetFlags ${SEC_SERVER} $0
  IntOp $0 $0 & ${SF_SELECTED}
  ${If} $0 != 0
    WriteRegStr HKLM "Software\HromadaAID\Installer" "DataDirectory" "$DataDirectory"
    WriteRegStr HKLM "Software\HromadaAID\Installer" "BackupDirectory" "$BackupDirectory"
  ${EndIf}
  SectionGetFlags ${SEC_CLIENT} $0
  IntOp $0 $0 & ${SF_SELECTED}
  StrCpy $1 ""
  ${If} $0 != 0
    StrCpy $1 "Client"
  ${EndIf}
  SectionGetFlags ${SEC_SERVER} $0
  IntOp $0 $0 & ${SF_SELECTED}
  ${If} $0 != 0
    ${If} $1 == ""
      StrCpy $1 "Server,ServerManager"
    ${Else}
      StrCpy $1 "$1,Server,ServerManager"
    ${EndIf}
  ${EndIf}
  WriteRegStr HKLM "Software\HromadaAID\Installer" "InstalledComponents" "$1"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayName" "HromadaAID"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayIcon" "$\"$INSTDIR\assets\hromadaaid.ico$\",0"
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM HromadaAID.exe /T'
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM "HromadaAID Server Manager.exe" /T'
  Sleep 500
  Call un.RemoveServerComponent
  !insertmacro SyncApplicationShortcuts 0 0
  RMDir /r "$INSTDIR\Client"
  RMDir /r "$INSTDIR\Server"
  RMDir /r "$INSTDIR\Server.next"
  RMDir /r "$INSTDIR\ServerManager"
  Delete "$INSTDIR\assets\hromadaaid.ico"
  RMDir "$INSTDIR\assets"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKLM "${UNINSTALL_KEY}"
  DeleteRegValue HKLM "Software\HromadaAID\Installer" "ProgramDirectory"
  DeleteRegValue HKLM "Software\HromadaAID\Installer" "InstalledComponents"
  DeleteRegValue HKLM "Software\HromadaAID\Installer" "InstallVersion"
  ; DataDirectory and BackupDirectory remain as safe reinstall/recovery locators.
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
  SectionSetFlags ${SEC_CLIENT} 0
  SectionSetFlags ${SEC_SERVER} 0
  ; The server branch also selects an existing Client; preserve Combined on rerun.
  IfFileExists "$INSTDIR\ServerManager\HromadaAID Server Manager.exe" selectInstalledServer 0
  IfFileExists "$INSTDIR\Server\service\HromadaAIDService.exe" selectInstalledServer 0
  IfFileExists "$INSTDIR\Server.next\package-integrity.json" selectInstalledServer 0
  IfFileExists "$INSTDIR\Server\package-integrity.json" selectInstalledServer 0
  IfFileExists "$INSTDIR\Client\HromadaAID.exe" selectInstalledClient 0
  ReadRegStr $1 HKLM "Software\HromadaAID\Installer" "InstalledComponents"
  ${If} $1 == "Server,ServerManager"
  ${OrIf} $1 == "Client,Server,ServerManager"
    MessageBox MB_ICONSTOP|MB_OK "Реєстр повідомляє про серверний компонент, але його файли не знайдено. Інсталятор зупинено, щоб не створити другу інсталяцію. Перевірте каталоги й Server Manager."
    Abort
  ${EndIf}
  SectionSetFlags ${SEC_CLIENT} ${SF_SELECTED}
  Goto initDone
selectInstalledClient:
  SectionSetFlags ${SEC_CLIENT} ${SF_SELECTED}
  Goto initDone
selectInstalledServer:
  SectionSetFlags ${SEC_SERVER} ${SF_SELECTED}
  IfFileExists "$INSTDIR\Client\HromadaAID.exe" 0 initDone
  SectionSetFlags ${SEC_CLIENT} ${SF_SELECTED}
initDone:
FunctionEnd

Function un.onInit
  SetRegView 64
  SetShellVarContext all
  ReadRegStr $DataDirectory HKLM "Software\HromadaAID\Installer" "DataDirectory"
  ReadRegStr $BackupDirectory HKLM "Software\HromadaAID\Installer" "BackupDirectory"
FunctionEnd

Function RemoveServerComponent
  IfFileExists "$INSTDIR\Server\*.*" 0 checkStagedServer
  Goto locateServiceControl
checkStagedServer:
  IfFileExists "$INSTDIR\Server.next\*.*" 0 checkPreviousServer
  Goto locateServiceControl
checkPreviousServer:
  IfFileExists "$INSTDIR\Server.previous\*.*" 0 checkFailedServer
  Goto locateServiceControl
checkFailedServer:
  IfFileExists "$INSTDIR\Server.failed\*.*" 0 checkManagerFiles
  Goto locateServiceControl
checkManagerFiles:
  IfFileExists "$INSTDIR\ServerManager\HromadaAID Server Manager.exe" 0 removeServerDone
locateServiceControl:
  IfFileExists "$INSTDIR\Server\installer\windows-service-control.ps1" useActiveServiceControl
  IfFileExists "$INSTDIR\Server.next\installer\windows-service-control.ps1" useStagedServiceControl
  IfFileExists "$INSTDIR\ServerManager\resources\server-payload\installer\windows-service-control.ps1" useManagerServiceControl
  MessageBox MB_ICONSTOP|MB_OK "Не знайдено перевірений сценарій керування Windows Service. Серверні файли залишено без змін."
  Abort
useActiveServiceControl:
  StrCpy $0 "$INSTDIR\Server\installer\windows-service-control.ps1"
  Goto runServiceRemoval
useStagedServiceControl:
  StrCpy $0 "$INSTDIR\Server.next\installer\windows-service-control.ps1"
  Goto runServiceRemoval
useManagerServiceControl:
  StrCpy $0 "$INSTDIR\ServerManager\resources\server-payload\installer\windows-service-control.ps1"
runServiceRemoval:
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$0" -Action uninstall -ProgramDirectory "$INSTDIR" -UpdateJournalPath "$DataDirectory\.hromadaaid-update-state.json"'
  Pop $1
  Pop $3
  ${If} $1 != 0
    MessageBox MB_ICONSTOP|MB_OK "Не вдалося безпечно видалити Windows Service або виявлено незавершену транзакцію. Усі серверні файли, дані й діагностику збережено. Перевірте стан через Server Manager. Код: $1"
    Abort
  ${EndIf}
  RMDir /r "$INSTDIR\Server"
  RMDir /r "$INSTDIR\Server.next"
  RMDir /r "$INSTDIR\ServerManager"
removeServerDone:
FunctionEnd

Function un.RemoveServerComponent
  IfFileExists "$INSTDIR\Server\*.*" unLocateServiceControl
  IfFileExists "$INSTDIR\Server.next\*.*" unLocateServiceControl
  IfFileExists "$INSTDIR\Server.previous\*.*" unLocateServiceControl
  IfFileExists "$INSTDIR\Server.failed\*.*" unLocateServiceControl
  IfFileExists "$INSTDIR\ServerManager\HromadaAID Server Manager.exe" unLocateServiceControl
  Return
unLocateServiceControl:
  IfFileExists "$INSTDIR\Server\installer\windows-service-control.ps1" unUseActiveServiceControl
  IfFileExists "$INSTDIR\Server.next\installer\windows-service-control.ps1" unUseStagedServiceControl
  IfFileExists "$INSTDIR\ServerManager\resources\server-payload\installer\windows-service-control.ps1" unUseManagerServiceControl
  MessageBox MB_ICONSTOP|MB_OK "Не знайдено сценарій керування службою. Серверні файли й дані збережено."
  Abort
unUseActiveServiceControl:
  StrCpy $0 "$INSTDIR\Server\installer\windows-service-control.ps1"
  Goto unRunServiceRemoval
unUseStagedServiceControl:
  StrCpy $0 "$INSTDIR\Server.next\installer\windows-service-control.ps1"
  Goto unRunServiceRemoval
unUseManagerServiceControl:
  StrCpy $0 "$INSTDIR\ServerManager\resources\server-payload\installer\windows-service-control.ps1"
unRunServiceRemoval:
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$0" -Action uninstall -ProgramDirectory "$INSTDIR" -UpdateJournalPath "$DataDirectory\.hromadaaid-update-state.json"'
  Pop $1
  Pop $3
  ${If} $1 != 0
    MessageBox MB_ICONSTOP|MB_OK "Виявлено незавершену транзакцію або службу не вдалося штатно видалити. Серверні файли, дані й діагностику збережено. Код: $1"
    Abort
  ${EndIf}
FunctionEnd

Function .onInstFailed
  IfFileExists "$PLUGINSDIR\windows-service-control.ps1" 0 installFailureDone
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\windows-service-control.ps1" -Action restore-after-failure -ProgramDirectory "$INSTDIR" -StateFile "$PLUGINSDIR\service-state.txt"'
  Pop $0
  Pop $3
installFailureDone:
FunctionEnd

Function HromadaAidRestoreServiceAfterAbort
  IfFileExists "$PLUGINSDIR\windows-service-control.ps1" 0 userAbortDone
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\windows-service-control.ps1" -Action restore-after-failure -ProgramDirectory "$INSTDIR" -StateFile "$PLUGINSDIR\service-state.txt"'
  Pop $0
  Pop $3
userAbortDone:
FunctionEnd

Function TrimPathTrailingSeparator
  Exch $0
trimPathTrailingSeparatorLoop:
  StrLen $1 $0
  ${If} $1 > 0
    StrCpy $2 $0 1 -1
    ${If} $2 == "\"
      IntOp $1 $1 - 1
      StrCpy $0 $0 $1
      Goto trimPathTrailingSeparatorLoop
    ${EndIf}
  ${EndIf}
  Exch $0
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
  Push "$INSTDIR"
  Call TrimPathTrailingSeparator
  Pop $PreflightProgramDirectory
  Push "$DataDirectory"
  Call TrimPathTrailingSeparator
  Pop $PreflightDataDirectory
  Push "$BackupDirectory"
  Call TrimPathTrailingSeparator
  Pop $PreflightBackupDirectory
  ; Keep PowerShell CodeDom compilation away from NSIS/plugin DLLs in the PLUGINSDIR root.
  SetOutPath "$PLUGINSDIR\Preflight"
  File /oname=windows-installer-paths.ps1 "${PROJECT_DIR}\packaging\windows-installer-paths.ps1"
  DetailPrint "Preflight launch: powershell=[$SYSDIR\WindowsPowerShell\v1.0\powershell.exe] script=[$PLUGINSDIR\Preflight\windows-installer-paths.ps1] cwd=[$PLUGINSDIR\Preflight] mode=[$ValidationMode] program=[$PreflightProgramDirectory] data=[$PreflightDataDirectory] backups=[$PreflightBackupDirectory] clientBytes=[${CLIENT_PAYLOAD_BYTES}] serverBytes=[${SERVER_PAYLOAD_BYTES}] managerBytes=[${MANAGER_PAYLOAD_BYTES}] supportBytes=[${INSTALLER_SUPPORT_BYTES}]"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\Preflight\windows-installer-paths.ps1" -Mode "$ValidationMode" -ProgramDirectory "$PreflightProgramDirectory" -DataDirectory "$PreflightDataDirectory" -BackupDirectory "$PreflightBackupDirectory" -ClientBytes ${CLIENT_PAYLOAD_BYTES} -ServerBytes ${SERVER_PAYLOAD_BYTES} -SupportBytes ${INSTALLER_SUPPORT_BYTES} -ManagerBytes ${MANAGER_PAYLOAD_BYTES}'
  Pop $2
  Pop $3
  DetailPrint "Попередня перевірка каталогів: код $2"
  ${If} $2 != 0
    DetailPrint "Діагностика preflight: $3"
    ${If} $2 == 3
      MessageBox MB_ICONSTOP|MB_OK "На одному з вибраних дисків недостатньо вільного місця. Звільніть місце або змініть відповідний каталог. Наявні дані не змінено.$\r$\n$3"
    ${ElseIf} $2 == 4
      MessageBox MB_ICONSTOP|MB_OK "Каталоги програми, даних і резервних копій мають бути на доступних локальних дисках NTFS. Перевірте диск і файлову систему.$\r$\n$3"
    ${ElseIf} $2 == 5
      MessageBox MB_ICONSTOP|MB_OK "Знайдено наявну базу, архів або server.json, що не відповідає вибраним каталогам. Для оновлення виберіть попередні шляхи або окремо перевірте дані адміністратора.$\r$\n$3"
    ${ElseIf} $2 == 6
      MessageBox MB_ICONSTOP|MB_OK "Каталоги програми, серверних даних і резервних копій не повинні перекриватися. Виберіть окремі каталоги.$\r$\n$3"
    ${Else}
      MessageBox MB_ICONSTOP|MB_OK "Не вдалося перевірити вибрані параметри. Код: $2$\r$\n$\r$\n$3$\r$\n$\r$\nНаявні дані не змінено. Перевірте зазначений етап і виправте його причину."
    ${EndIf}
    Abort
  ${EndIf}
FunctionEnd
