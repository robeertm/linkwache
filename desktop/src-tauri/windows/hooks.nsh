; Linkwache NSIS hooks (per-user install, no admin rights).
; After installing: register as a browser candidate under HKCU and install the native-messaging
; host manifests (the app does the same on every start, so the MSI is covered too).
; Before uninstalling: remove those registrations again.
!macro NSIS_HOOK_POSTINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --register'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --unregister'
!macroend
