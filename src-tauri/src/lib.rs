use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External("https://www.autothresh.com".parse().unwrap()),
            )
            .title("AutoThresh")
            .inner_size(1280.0, 820.0)
            .min_inner_size(1000.0, 680.0)
            .center()
            .resizable(true)
            .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AutoThresh");
}
