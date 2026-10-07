use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 작업표시줄 주황색 깜빡임(남은 주황색 표시 포함)을 즉시 끈다.
/// JS의 requestUserAttention(null)은 이미 활성화된 창이면 아무것도 하지 않으므로
/// "창을 확인하는 순간 끄기"를 위해 FlashWindowEx(FLASHW_STOP)를 직접 부른다.
/// 동기 명령이라 메인(UI) 스레드에서 실행된다.
#[tauri::command]
fn stop_taskbar_flash(app: AppHandle, label: String) {
    #[cfg(windows)]
    if let Some(win) = app.get_webview_window(&label) {
        if let Ok(hwnd) = win.hwnd() {
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                FlashWindowEx, FLASHWINFO, FLASHW_STOP,
            };
            let info = FLASHWINFO {
                cbSize: std::mem::size_of::<FLASHWINFO>() as u32,
                hwnd: hwnd.0 as _,
                dwFlags: FLASHW_STOP,
                uCount: 0,
                dwTimeout: 0,
            };
            unsafe {
                FlashWindowEx(&info);
            }
        }
    }
    #[cfg(not(windows))]
    let _ = (app, label);
}

/// 트레이에 숨겨 둔 메인 창을 다시 띄운다.
fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 트레이 아이콘: 클릭하면 메인 창 열기, 메뉴 '종료'로만 실제 종료한다.
            let open_item = MenuItem::with_id(app, "open", "열기", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("mykatalk")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // 메인 창 X/Alt+F4 → 종료하지 않고 트레이로 숨긴다 (소켓은 계속 살아 있음)
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![greet, stop_taskbar_flash])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
