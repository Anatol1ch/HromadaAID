param([Parameter(Mandatory=$true)][long]$WindowHandle,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WindowIconReader {
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
 [DllImport("user32.dll", EntryPoint="GetClassLongPtrW")] public static extern IntPtr GetClassLongPtr(IntPtr hwnd, int index);
}
'@
foreach($item in @(@('small',0,-34),@('large',1,-14))) {
 $handle=[WindowIconReader]::SendMessage([IntPtr]$WindowHandle,0x007F,[IntPtr]([int]$item[1]),[IntPtr]::Zero)
 if($handle -eq [IntPtr]::Zero){$handle=[WindowIconReader]::GetClassLongPtr([IntPtr]$WindowHandle,[int]$item[2])}
 if($handle -eq [IntPtr]::Zero){throw 'Window did not supply an icon'}
 # Never destroy the returned HICON: it belongs to the inspected application.
 $icon=[Drawing.Icon]::FromHandle($handle)
 $bitmap=$icon.ToBitmap()
 try{$bitmap.Save((Join-Path $OutputDirectory ($item[0]+'.png')),[Drawing.Imaging.ImageFormat]::Png)}finally{$bitmap.Dispose();$icon.Dispose()}
}
