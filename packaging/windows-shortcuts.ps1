param(
  [string]$ProgramDirectory,
  [ValidateSet(0, 1)][int]$ClientSelected = 0,
  [ValidateSet(0, 1)][int]$ManagerSelected = 0,
  [switch]$LibraryOnly
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding -ArgumentList $false

# IShellLink's property store is the Windows API for a shortcut AppUserModelID.
# Keep the IDs identical to Electron main and electron-builder. No registry writes.
if (-not ('HromadaAid.ShortcutIdentity' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
namespace HromadaAid {
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class ShellLink {}
  [StructLayout(LayoutKind.Sequential)] struct PropertyKey { public Guid format; public uint id; }
  [StructLayout(LayoutKind.Explicit, Size = 24)] struct PropVariant {
    [FieldOffset(0)] public ushort type;
    [FieldOffset(8)] public IntPtr text;
  }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int GetAt(uint index, out PropertyKey key);
    [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
    [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
    [PreserveSig] int Commit();
  }
  [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, IntPtr data, uint flags);
    void GetIDList(out IntPtr list);
    void SetIDList(IntPtr list);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int size);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string text);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string path);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int size);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string text);
    void GetHotkey(out short key);
    void SetHotkey(short key);
    void GetShowCmd(out int command);
    void SetShowCmd(int command);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, out int index);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
    void Resolve(IntPtr owner, uint flags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
  }
  public sealed class ShortcutInfo { public string Target; public string Arguments; public string Icon; public int IconIndex; }
  public static class ShortcutIdentity {
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);
    static PropertyKey AppIdKey() { return new PropertyKey { format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), id = 5 }; }
    public static ShortcutInfo Info(string path) {
      object link = new ShellLink();
      try {
        ((IPersistFile)link).Load(path, 0);
        var native = (IShellLinkW)link;
        var target = new StringBuilder(32768); var arguments = new StringBuilder(32768); var icon = new StringBuilder(32768); int index;
        native.GetPath(target, target.Capacity, IntPtr.Zero, 4); // SLGP_RAWPATH; never resolve or run the target.
        native.GetArguments(arguments, arguments.Capacity);
        native.GetIconLocation(icon, icon.Capacity, out index);
        return new ShortcutInfo { Target = target.ToString(), Arguments = arguments.ToString(), Icon = icon.ToString(), IconIndex = index };
      } finally { Marshal.FinalReleaseComObject(link); }
    }
    public static void SaveLink(string path, string target, string arguments) {
      object link = new ShellLink();
      try {
        var file = (IPersistFile)link;
        if (System.IO.File.Exists(path)) file.Load(path, 2);
        var native = (IShellLinkW)link;
        native.SetPath(target); native.SetArguments(arguments);
        native.SetWorkingDirectory(System.IO.Path.GetDirectoryName(target));
        native.SetIconLocation(target, 0); native.SetShowCmd(1);
        file.Save(path, true);
      } finally { Marshal.FinalReleaseComObject(link); }
    }
    public static string Read(string path) {
      object link = new ShellLink();
      try {
        ((IPersistFile)link).Load(path, 0);
        var key = AppIdKey(); PropVariant value;
        Marshal.ThrowExceptionForHR(((IPropertyStore)link).GetValue(ref key, out value));
        try {
          if (value.type == 0 || value.type == 1) return "";
          if (value.type != 31) throw new InvalidOperationException("Unexpected shortcut identity type.");
          return Marshal.PtrToStringUni(value.text);
        }
        finally { PropVariantClear(ref value); }
      } finally { Marshal.FinalReleaseComObject(link); }
    }
    public static void Write(string path, string appId) {
      object link = new ShellLink();
      try {
        var file = (IPersistFile)link; file.Load(path, 2);
        var store = (IPropertyStore)link;
        var key = AppIdKey();
        var value = new PropVariant { type = 31, text = Marshal.StringToCoTaskMemUni(appId) };
        try { Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref value)); }
        finally { PropVariantClear(ref value); }
        Marshal.ThrowExceptionForHR(store.Commit());
        file.Save(path, true);
      } finally { Marshal.FinalReleaseComObject(link); }
    }
  }
}
'@
}

function Sync-ApplicationShortcut([string]$Path, [string]$Target, [string]$AppId, [bool]$Selected) {
    $exists = Test-Path -LiteralPath $Path
    if ($exists) {
      $item = Get-Item -LiteralPath $Path -Force
      if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return 'preserved-foreign' }
      try {
        $link = [HromadaAid.ShortcutIdentity]::Info($Path)
        $ownedTarget = $link.Target
        $identity = [HromadaAid.ShortcutIdentity]::Read($Path)
        if (-not $ownedTarget -or -not [string]::Equals([IO.Path]::GetFullPath($ownedTarget), [IO.Path]::GetFullPath($Target), [StringComparison]::OrdinalIgnoreCase) -or
            $link.Arguments -ne '' -or ($identity -and $identity -ne $AppId)) { return 'preserved-foreign' }
      } catch { return 'preserved-unreadable' }
    }
    if (-not $Selected -or -not (Test-Path -LiteralPath $Target -PathType Leaf)) {
      if ($exists) { Remove-Item -LiteralPath $Path -Force; return 'removed' }
      return 'absent'
    }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path)) | Out-Null
    [HromadaAid.ShortcutIdentity]::SaveLink($Path, $Target, '')
    [HromadaAid.ShortcutIdentity]::Write($Path, $AppId)
    if ($exists) { return 'updated' }
    return 'created'
}

function Sync-HromadaAidShortcuts([string]$Program, [string]$StartMenu, [string]$Desktop, [int]$Client, [int]$Manager) {
  if (-not [IO.Path]::IsPathRooted($Program) -or -not $StartMenu -or -not $Desktop) { throw 'Некоректні каталоги для ярликів HromadaAID.' }
  $components = @(
    @{ Name = 'HromadaAID'; Target = (Join-Path $Program 'Client\HromadaAID.exe'); Id = 'local.hromadaaid'; Selected = ($Client -eq 1) },
    @{ Name = 'HromadaAID Server Manager'; Target = (Join-Path $Program 'ServerManager\HromadaAID Server Manager.exe'); Id = 'local.hromadaaid.server-manager'; Selected = ($Manager -eq 1) }
  )
  foreach ($component in $components) {
    foreach ($directory in @($StartMenu, $Desktop)) {
      $path = Join-Path $directory ($component.Name + '.lnk')
      $result = Sync-ApplicationShortcut $path $component.Target $component.Id $component.Selected
      if ($result -like 'preserved-*') { [Console]::Out.WriteLine("Збережено сторонній або недоступний ярлик: $path") }
    }
  }
}

if ($LibraryOnly) { return }
try {
  # Common folders match NSIS SetShellVarContext all; never touch per-user pins.
  Sync-HromadaAidShortcuts $ProgramDirectory ([Environment]::GetFolderPath('CommonPrograms')) ([Environment]::GetFolderPath('CommonDesktopDirectory')) $ClientSelected $ManagerSelected
} catch {
  [Console]::Out.WriteLine('Не вдалося налаштувати ярлики HromadaAID. Наявні сторонні ярлики не видалялися.')
  exit 1
}
