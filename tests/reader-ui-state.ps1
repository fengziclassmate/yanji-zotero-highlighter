param([string]$TitleToken)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;using System.Text;using System.Runtime.InteropServices;using System.Collections.Generic;
public static class ReaderProbe{public delegate bool E(IntPtr h,IntPtr p);[DllImport("user32.dll")]public static extern bool EnumWindows(E e,IntPtr p);[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder b,int n);[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();public static IntPtr[] All(){var list=new List<IntPtr>();EnumWindows((h,p)=>{list.Add(h);return true;},IntPtr.Zero);return list.ToArray();}public static string Title(IntPtr h){var b=new StringBuilder(600);GetWindowText(h,b,600);return b.ToString();}}
'@
$rows=@()
foreach($handle in [ReaderProbe]::All()){
 if([ReaderProbe]::Title($handle)-notlike"*$TitleToken*"){continue}
 $window=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
 $edits=@($window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit))|ForEach-Object {$value=$null;$p=$null;if($_.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$p)){$value=$p.Current.Value};@{Name=$_.Current.Name;Id=$_.Current.AutomationId;Class=$_.Current.ClassName;Value=$value}})
 $buttons=@($window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)|Where-Object {$_.Current.Name-match'下载|保存|Download|Save'-or$_.Current.AutomationId-match'download|save'}|Select-Object -First 12|ForEach-Object {@{Name=$_.Current.Name;Id=$_.Current.AutomationId;Class=$_.Current.ClassName;Type=$_.Current.ControlType.ProgrammaticName;Enabled=$_.Current.IsEnabled}})
 $rows+=@{Title=$window.Current.Name;Handle=$handle.ToInt64();Edits=$edits;Buttons=$buttons}
}
@{Foreground=[ReaderProbe]::GetForegroundWindow().ToInt64();ForegroundTitle=[ReaderProbe]::Title([ReaderProbe]::GetForegroundWindow());Windows=$rows}|ConvertTo-Json -Depth 6 -Compress
