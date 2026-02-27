import os
import sys
import webbrowser
import threading
import time
import socket
import traceback
from http.server import HTTPServer, SimpleHTTPRequestHandler

# --- ФУНКЦИЯ ДЛЯ ПОИСКА СВОБОДНОГО ПОРТА ---
def find_free_port(start_port=8000):
    for port in range(start_port, start_port + 100):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                # Если connect_ex возвращает 0, значит порт занят
                if sock.connect_ex(('localhost', port)) != 0:
                    return port
        except:
            continue
    return 0

def run_launcher():
    # 1. ОПРЕДЕЛЯЕМ ПАПКУ, ГДЕ ЛЕЖИТ EXE
    if getattr(sys, 'frozen', False):
        BASE_DIR = os.path.dirname(sys.executable)
    else:
        BASE_DIR = os.path.dirname(os.path.abspath(__file__))

    # Переходим в эту папку (ВАЖНО!)
    os.chdir(BASE_DIR)
    print(f"Рабочая папка: {BASE_DIR}")

    # 2. ПРОВЕРЯЕМ ФАЙЛЫ
    if not os.path.exists("index.html"):
        print("\n[ОШИБКА] Не найден файл index.html!")
        print("Убедитесь, что вы распаковали архив целиком.")
        print(f"Список файлов в папке: {os.listdir(BASE_DIR)}")
        input("\nНажмите Enter, чтобы закрыть...")
        sys.exit(1)

    # 3. ИЩЕМ ПОРТ
    PORT = find_free_port(8000)
    if PORT == 0:
        print("[ОШИБКА] Нет свободных портов!")
        input("Нажмите Enter...")
        sys.exit(1)

    # 4. ЗАПУСКАЕМ СЕРВЕР
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

    httpd = HTTPServer(('127.0.0.1', PORT), QuietHandler)
    
    # Запуск в отдельном потоке
    server_thread = threading.Thread(target=httpd.serve_forever)
    server_thread.daemon = True
    server_thread.start()

    print(f"Сервер работает: http://localhost:{PORT}")

    # 5. ОТКРЫВАЕМ БРАУЗЕР
    time.sleep(1)
    url = f"http://localhost:{PORT}/index.html"
    webbrowser.open(url)

    print("\n>>> ОКНО НЕ ЗАКРЫВАТЬ <<<")
    
    # Держим окно открытым
    while True:
        time.sleep(1)

# ГЛАВНЫЙ БЛОК ПЕРЕХВАТА ОШИБОК
if __name__ == "__main__":
    try:
        run_launcher()
    except Exception:
        print("\n" + "!"*50)
        print("ПРОИЗОШЛА ОШИБКА:")
        traceback.print_exc() # Печатает подробности ошибки
        print("!"*50)
        input("\nСделайте скриншот и нажмите Enter для выхода...")