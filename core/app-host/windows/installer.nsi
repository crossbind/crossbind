; A crossbind app's setup program. It installs the app for the user who runs it, with no administrator's approval, in
; %LOCALAPPDATA%\Programs, puts it in the Start menu and among the apps Settings lists, and installs the WebView2
; Runtime the app runs on when the system has none. crossbind defines NAME, EXE, ID, VERSION, APP and OUTFILE, ICON for
; an app with an icon, SCHEMES for one with URL schemes, and SIGNER with a signing key. The app's updater runs it with
; /S /UPDATE /D=<the app's folder>.
Unicode true
ManifestDPIAware true
RequestExecutionLevel user
; LZMA would compress better, but NSIS's module for it is under CPL-1.0, whose binaries carry terms of their own.
SetCompressor /SOLID zlib

; With a key, crossbind defines SIGNER, the script that signs the uninstaller and this setup program as they are written.
!ifdef SIGNER
  !uninstfinalize 'sh "${SIGNER}" "%1"' = 0
  !finalize 'sh "${SIGNER}" "%1"' = 0
!endif

!include MUI2.nsh
!include LogicLib.nsh
!include FileFunc.nsh

; With app.urlSchemes, crossbind defines SCHEMES, a file whose CROSSBIND_URL_SCHEMES macro calls the one it is given on
; each scheme: a link of the scheme opens the app with the link as its argument.
!ifdef SCHEMES
  !include "${SCHEMES}"

  ; A class of the name that is no URL scheme, as a file type's, keeps what it opens: its key has subkeys or values, but
  ; no "URL Protocol".
  !macro RegisterScheme SCHEME
    StrCpy $1 ""
    ClearErrors
    ReadRegStr $0 HKCR "${SCHEME}" "URL Protocol"
    ${If} ${Errors}
      ClearErrors
      EnumRegKey $0 HKCR "${SCHEME}" 0
      ${IfNot} ${Errors}
      ${AndIf} $0 != ""
        StrCpy $1 "taken"
      ${EndIf}
      ClearErrors
      EnumRegValue $0 HKCR "${SCHEME}" 0
      ${IfNot} ${Errors}
      ${AndIf} $0 != ""
        StrCpy $1 "taken"
      ${EndIf}
    ${EndIf}
    ${If} $1 == "taken"
      DetailPrint "${SCHEME} is the name of a class that is no URL scheme, which keeps what it opens"
    ${Else}
      WriteRegStr HKCU "Software\Classes\${SCHEME}" "" "URL:${NAME}"
      WriteRegStr HKCU "Software\Classes\${SCHEME}" "URL Protocol" ""
      WriteRegStr HKCU "Software\Classes\${SCHEME}\DefaultIcon" "" '"$INSTDIR\${EXE}",0'
      WriteRegStr HKCU "Software\Classes\${SCHEME}\shell\open\command" "" '"$INSTDIR\${EXE}" "%1"'
    ${EndIf}
  !macroend

  !macro ListedScheme SCHEME
    ${If} $0 == "${SCHEME}"
      StrCpy $2 "listed"
    ${EndIf}
  !macroend
!endif

; The URL schemes a release of the app registered are those whose link opens its executable. An update removes the ones
; this release no longer lists and the uninstaller all of them; a scheme another app took over since stays its own.
!macro UnregisterSchemes KEEP_LISTED
  StrCpy $3 0
  ${Do}
    ClearErrors
    EnumRegKey $0 HKCU "Software\Classes" $3
    ${If} ${Errors}
    ${OrIf} $0 == ""
      ${Break}
    ${EndIf}
    StrCpy $2 ""
    !if ${KEEP_LISTED} == 1
      !ifdef SCHEMES
        !insertmacro CROSSBIND_URL_SCHEMES ListedScheme
      !endif
    !endif
    ClearErrors
    ReadRegStr $1 HKCU "Software\Classes\$0" "URL Protocol"
    ${IfNot} ${Errors}
    ${AndIf} $2 != "listed"
      ReadRegStr $1 HKCU "Software\Classes\$0\shell\open\command" ""
      ${If} $1 == '"$INSTDIR\${EXE}" "%1"'
        ClearErrors
        DeleteRegKey HKCU "Software\Classes\$0"
        ; The next class takes the index of the one removed.
        ${IfNot} ${Errors}
          ${Continue}
        ${EndIf}
      ${EndIf}
    ${EndIf}
    IntOp $3 $3 + 1
  ${Loop}
!macroend

Name "${NAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${NAME}"
!define UNINSTALL "Software\Microsoft\Windows\CurrentVersion\Uninstall\${ID}"
; Where EdgeUpdate records the release of the WebView2 Runtime it installed: for the machine, which a 32-bit setup
; program reads under WOW6432Node, or for the user.
!define WEBVIEW2 "Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

!ifdef ICON
  !define MUI_ICON "${ICON}"
  !define MUI_UNICON "${ICON}"
!endif
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; Set by /UPDATE.
Var Updating
; How many half seconds an update waits for the app that started it to quit.
!define QUIT_WAIT 60

Function .onInit
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/UPDATE" $1
  ${IfNot} ${Errors}
    StrCpy $Updating 1
  ${EndIf}
FunctionEnd

; The app holds its executable while it runs. An update the app started waits for it to quit; another one or an
; uninstall stops before it changes anything.
!macro StopWhileRunning
  StrCpy $1 0
  ${Do}
    ClearErrors
    FileOpen $0 "$INSTDIR\${EXE}" a
    ${IfNot} ${Errors}
      FileClose $0
      ${Break}
    ${EndIf}
    IntOp $1 $1 + 1
    ${If} $Updating != 1
    ${OrIf} $1 > ${QUIT_WAIT}
      ; An update that waited in vain opens the app it leaves, which quit to let it run.
      ${If} $Updating == 1
        Exec '"$INSTDIR\${EXE}"'
      ${EndIf}
      MessageBox MB_ICONSTOP "${NAME} is running. Close it and try again." /SD IDOK
      Abort
    ${EndIf}
    Sleep 500
  ${Loop}
!macroend

Section
  ; An update replaces the page and data of the release before rather than adding to them. A folder without the app in
  ; it is none the setup program made, and keeps its own.
  ${If} ${FileExists} "$INSTDIR\${EXE}"
    !insertmacro StopWhileRunning
    RMDir /r "$INSTDIR\resources"
  ${EndIf}
  Call InstallWebView2
  SetOutPath "$INSTDIR"
  File /r "${APP}/*"
  WriteUninstaller "$INSTDIR\uninstall.exe"
  CreateShortcut "$SMPROGRAMS\${NAME}.lnk" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNINSTALL}" "DisplayName" "${NAME}"
  WriteRegStr HKCU "${UNINSTALL}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNINSTALL}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL}" "NoRepair" 1
  !insertmacro UnregisterSchemes 1
!ifdef SCHEMES
  !insertmacro CROSSBIND_URL_SCHEMES RegisterScheme
!endif
SectionEnd

; An update opens the app anew once it is installed.
Function .onInstSuccess
  ${If} $Updating == 1
    Exec '"$INSTDIR\${EXE}"'
  ${EndIf}
FunctionEnd

; Microsoft's Evergreen Bootstrapper, behind this link, downloads the runtime and installs it for the user.
Function InstallWebView2
  ReadRegStr $0 HKLM "SOFTWARE\${WEBVIEW2}" "pv"
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    ReadRegStr $0 HKCU "Software\${WEBVIEW2}" "pv"
  ${EndIf}
  ${If} $0 != ""
  ${AndIf} $0 != "0.0.0.0"
    Return
  ${EndIf}
  DetailPrint "Installing the WebView2 Runtime"
  InitPluginsDir
  System::Call 'urlmon::URLDownloadToFileW(p 0, w "https://go.microsoft.com/fwlink/p/?LinkId=2124703", w "$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe", i 0, p 0) i .r0'
  ; HTTPS does not tell what was downloaded: the bootstrapper runs only with a valid signature of Microsoft's, which
  ; PowerShell checks, started by its path rather than its name, which the setup program's own folder could answer.
  ; It is the system's own PowerShell, which this 32-bit program reaches through Sysnative, and it loads the module of
  ; the check from its own folder: a PSModulePath inherited from PowerShell 7 names that release's module first, which
  ; Windows PowerShell cannot load.
  ${If} $0 == 0
    System::Call 'kernel32::SetEnvironmentVariable(t "CROSSBIND_WEBVIEW2_BOOTSTRAPPER", t "$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe")'
    nsExec::ExecToStack /TIMEOUT=60000 `"$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "Import-Module (Join-Path $$PSHOME 'Modules\Microsoft.PowerShell.Security'); $$signature = Get-AuthenticodeSignature -LiteralPath $$env:CROSSBIND_WEBVIEW2_BOOTSTRAPPER; if ($$signature.Status -ne 'Valid' -or $$signature.SignerCertificate.Subject -notmatch '^CN=Microsoft Corporation,') { exit 1 }"`
    Pop $0
    Pop $1
    System::Call 'kernel32::SetEnvironmentVariable(t "CROSSBIND_WEBVIEW2_BOOTSTRAPPER", p 0)'
    ${If} $0 != 0
      DetailPrint "The WebView2 bootstrapper that downloaded carries no valid signature of Microsoft's"
    ${EndIf}
  ${EndIf}
  ${If} $0 == 0
    ExecWait '"$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe" /silent /install' $0
  ${EndIf}
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "${NAME} runs on the WebView2 Runtime, which could not be installed. Install it from https://developer.microsoft.com/microsoft-edge/webview2/ and run this setup again." /SD IDOK
    Abort
  ${EndIf}
FunctionEnd

; It leaves the app's data and its WebView2 profile, which are the user's.
Section Uninstall
  ${If} ${FileExists} "$INSTDIR\${EXE}"
    !insertmacro StopWhileRunning
    Delete "$INSTDIR\${EXE}"
    RMDir /r "$INSTDIR\resources"
  ${EndIf}
  Delete "$SMPROGRAMS\${NAME}.lnk"
  !insertmacro UnregisterSchemes 0
  DeleteRegKey HKCU "${UNINSTALL}"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
