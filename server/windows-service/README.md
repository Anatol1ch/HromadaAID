# Windows Service deployment notes

This is an install-time template only. It does not register, start, stop, or modify a Windows service. The future installer must replace `__PROGRAM_DIRECTORY__` and `__DATA_DIRECTORY__` with the selected absolute paths, XML-escape them, write the rendered XML beside a renamed WinSW executable, and then call that executable's `install` command. It must start the service only after paths, ACLs, configuration, database, and backup key have been validated. Do not run the template as-is.

## Service host choice

Use the stable WinSW 2.12.0 release, pinned and hash-verified by the future installer, as a small SCM wrapper around the already-built server entry point. The current Electron NSIS packaging only packages the desktop client; WiX can register SCM services but cannot make this Node.js entry point speak the Windows service protocol on its own. WinSW supplies SCM status, start/stop/restart commands, child-process supervision, bounded recovery actions, stdout/stderr capture, and size-based log rotation. Its stop path sends Ctrl+C and waits before its documented forced-stop fallback, which allows Node to receive SIGINT and run the graceful shutdown implemented in `server-runtime.ts`.

Do not use the latest WinSW 3 prerelease for the first deployment without a separate qualification pass. NSSM's published stable release is old; do not choose it only for familiarity. If service lifecycle requirements later outgrow the wrapper, a small dedicated SCM host can replace WinSW, but that would be a separately tested component.

## Runtime layout and invocation

The installer should put the pinned official Node.js runtime under `runtime\node.exe`, the compiled server output and production dependencies under `server\`, and the rendered service definition beside the WinSW executable. As of October 2026, Node 24.22.1 is the current Node 24 LTS security release; qualify the then-current patched Node 24 LTS build, `node:sqlite`, and the `argon2` native module together before shipping. Build/copy `argon2` for that exact runtime ABI. The service launches `installed.js --config <absolute server.json>` directly; `pnpm`, a global Node installation, Electron, and the process current directory are not runtime dependencies.

Once the installer renders and qualifies this template, the renamed wrapper's documented commands provide service control, for example `HromadaAIDService.exe install`, then `start`, `status`, `stop`, or `restart`. These commands are not run in this stage. Uninstalling the service must not remove the separate data or backup directories.

`workingdirectory` is explicit for predictable third-party/native module loading, but all persistent paths still come from `server.json`. The database process-lock in `restore-safety.ts` is an OS-backed SQLite exclusive lock. A second process using the same database fails closed; the lock is released by SQLite when the owning process exits, including after a crash. Never start a second service instance with a different config pointing at the same SQLite.

The service starts automatically with Windows. Administrators can use WinSW's `start`, `stop`, `restart`, and `status` commands. Recovery attempts are bounded: restart once after 10 seconds, once after 30 seconds, then leave the service stopped. After one stable day the failure counter resets. An invalid configuration therefore cannot trigger an endless restart loop; its startup diagnostic remains in the captured logs.

The five-minute wrapper stop timeout is a last-resort ceiling, not the normal shutdown mechanism. Fastify first stops accepting connections and drains in-flight requests; then the backup scheduler and archive work stop, SQLite closes, the process lock releases, and the in-memory backup key is cleared. A 45-second diagnostic warns if a phase is slow and continues waiting without closing SQLite early. If the wrapper reaches its ceiling, it can forcibly terminate the process; that indicates a failed graceful stop and must be treated as an operational incident. WinSW 2's documented stop timeout does not itself prove behavior during every Windows shutdown/preshutdown deadline, so test full OS shutdown and restart on each supported Windows release during installer qualification.

## Account, ACL, DPAPI, and TLS

The template uses Windows `LocalService`, never `LocalSystem`. It has limited local privileges and no general network credentials. The installer should enable the unique service SID `NT SERVICE\HromadaAIDApi` (`sc.exe sidtype HromadaAIDApi unrestricted`) before first start, then assign the file ACLs to that SID. This provides per-service file isolation while keeping the low-privilege built-in logon and avoids storing an account password in the service definition. Verify the configured SID type before granting ACLs. The future installer must grant only:

- Program files, runtime, and production modules: the service SID read/execute; administrators and installer may update them.
- Server JSON: the service SID read; administrators/installer write. The file contains paths and transport settings, not passwords or backup keys.
- SQLite directory and restore journal/staging: the service SID modify; administrators full control. This includes SQLite WAL/SHM and the process-lock file.
- Backup and log directories: the service SID modify; administrators full control. Do not grant ordinary users write access.
- TLS certificate: the service SID read. TLS private key: read only for the service SID and administrators; no ordinary user access.
- The DPAPI backup-key file: read only for the service SID and administrators; write only during explicit key setup/recovery procedures. Do not recreate it automatically if absent.

The backup key uses DPAPI `LocalMachine` scope. It is not bound to the account that created it, so the service can unprotect it under `LocalService` on the same Windows machine if its ACL permits reading. The DPAPI file is still machine-bound and is not a disaster-recovery copy; the separately protected recovery key remains necessary. The installer must not migrate, replace, or recreate existing keys. Network TLS private keys should be provisioned with similarly narrow ACLs; no key contents belong in logs or JSON.

## Logging and unavailable storage

WinSW captures stdout/stderr in the configured data `Logs` directory, rolls at 10 MiB, and keeps eight rolled files per stream. The wrapper may also keep a wrapper log there. The installer must create the log directory and apply ACLs before service registration. Existing Fastify logs should remain free of request bodies, session tokens, passwords, private keys, backup secrets, and recipient/financial data.

If the configured database or backup drive is absent, inaccessible, or invalid at startup, installed path validation fails and the service exits with a non-zero code. Windows recovery applies only the bounded attempts above, then leaves the service stopped for diagnosis. It must never create an alternate SQLite or key. For removable/mapped/network locations, this project intentionally requires local fixed NTFS storage for SQLite/WAL; mapped drives are not reliable in a service logon session. The wrapper does not map drives.

## What must still be qualified by the installer stage

The future installer must render the selected paths safely, package/hash-verify WinSW and the matching Node runtime, create the service only after ACL/config preflight, preserve data/config/backup paths during upgrades and uninstall, and manually test SCM status, stop timeout, Windows restart recovery, service-account ACLs, unavailable disks, and DPAPI access. This stage has not installed or changed a Windows service or any system ACL.
