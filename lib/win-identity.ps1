# DSH Notify - Windows notification identity provisioning.
#
# Windows requires two things before a desktop app's toasts show a banner:
#
#   1. An AppUserModelId registration, so the app appears in
#      Settings -> Notifications at all:
#        HKCU\Software\Classes\AppUserModelId\<AUMID>   (DisplayName)
#   2. A Start Menu shortcut carrying the AppUserModelID property. Without it
#      Windows accepts the toast but only files it in the notification centre -
#      no banner, no sound.
#
# This script is idempotent: a marker value plus the shortcut file make the
# second run a no-op, so the expensive C# interop is only compiled once per
# machine. It never writes to stdout and always exits 0 - a provisioning
# failure must never disturb the harness.

$ErrorActionPreference = 'SilentlyContinue'

$Aumid        = 'com.lalilulelo3.dsh-notify'
$DisplayName  = 'DSH Notify'
$MarkerName   = 'ShortcutVersion'
$MarkerValue  = '1'

$regKey = "HKCU:\Software\Classes\AppUserModelId\$Aumid"
$lnk    = Join-Path ([Environment]::GetFolderPath('Programs')) "$DisplayName.lnk"

# Fast path: we already provisioned this machine.
$marker = (Get-ItemProperty -Path $regKey -Name $MarkerName -ErrorAction SilentlyContinue).$MarkerName
if ((Test-Path $lnk) -and ($marker -eq $MarkerValue)) { exit 0 }

# --- 1. AUMID registration (makes the app appear in notification settings) ---
if (-not (Test-Path $regKey)) { New-Item -Path $regKey -Force | Out-Null }
New-ItemProperty -Path $regKey -Name 'DisplayName' -Value $DisplayName -PropertyType String -Force | Out-Null

# --- 2. Start Menu shortcut carrying the AppUserModelID property ------------
$code = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace DshNotifyIdentity {
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
  public class ShellLink { }

  [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder p, int c, IntPtr f, int fl);
    void GetIDList(out IntPtr p); void SetIDList(IntPtr p);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder p, int c);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string p);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder p, int c);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string p);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder p, int c);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string p);
    void GetHotkey(out short k); void SetHotkey(short k);
    void GetShowCmd(out int s); void SetShowCmd(int s);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder p, int c, out int i);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string p, int i);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string p, int r);
    void Resolve(IntPtr h, int f);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string p);
  }

  [ComImport, Guid("0000010b-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPersistFile {
    void GetClassID(out Guid g); void IsDirty();
    void Load([MarshalAs(UnmanagedType.LPWStr)] string f, uint m);
    void Save([MarshalAs(UnmanagedType.LPWStr)] string f, [MarshalAs(UnmanagedType.Bool)] bool r);
    void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string f);
    void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string f);
  }

  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  public struct PropertyKey { public Guid fmtid; public uint pid; }

  // PROPVARIANT is 24 bytes on x64 (2-byte vt + 6 bytes padding + 16-byte union).
  // Declaring it too small silently discards the write.
  [StructLayout(LayoutKind.Explicit, Size = 24)]
  public struct PropVariant {
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(8)] public IntPtr ptr;
  }

  [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    uint GetCount();
    void GetAt(uint i, out PropertyKey k);
    void GetValue(ref PropertyKey k, out PropVariant v);
    void SetValue(ref PropertyKey k, ref PropVariant v);
    void Commit();
  }

  public static class Shortcut {
    static PropertyKey AumidKey() {
      var k = new PropertyKey();
      k.fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
      k.pid = 5;
      return k;
    }

    public static bool Write(string lnkPath, string target, string aumid) {
      var link = (IShellLinkW)new ShellLink();
      link.SetPath(target);
      link.SetDescription("DSH Notify - DeepSeek Harness desktop notifications");
      var store = (IPropertyStore)link;
      var key = AumidKey();
      var pv = new PropVariant();
      pv.vt = 31; // VT_LPWSTR
      pv.ptr = Marshal.StringToCoTaskMemUni(aumid);
      try {
        store.SetValue(ref key, ref pv);
        store.Commit();
      } finally {
        Marshal.FreeCoTaskMem(pv.ptr);
      }
      ((IPersistFile)link).Save(lnkPath, true);
      return true;
    }

    public static string Read(string lnkPath) {
      var link = (IShellLinkW)new ShellLink();
      ((IPersistFile)link).Load(lnkPath, 0);
      var store = (IPropertyStore)link;
      var key = AumidKey();
      PropVariant pv;
      store.GetValue(ref key, out pv);
      return (pv.vt == 31 && pv.ptr != IntPtr.Zero) ? Marshal.PtrToStringUni(pv.ptr) : "";
    }
  }
}
'@

try {
  Add-Type -TypeDefinition $code -Language CSharp -ErrorAction Stop
  $target = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  [void][DshNotifyIdentity.Shortcut]::Write($lnk, $target, $Aumid)

  # Only mark the machine provisioned once the property really landed.
  if ([DshNotifyIdentity.Shortcut]::Read($lnk) -eq $Aumid) {
    New-ItemProperty -Path $regKey -Name $MarkerName -Value $MarkerValue -PropertyType String -Force | Out-Null
  }
} catch {
  # Leave the marker unset so the next run retries.
}

exit 0
