import os
import json
import time
import re
from pathlib import Path

# --- КОНФИГУРАЦИЯ ---
LOG_PATH = Path(os.path.expanduser("~/Documents/My Games/Sid Meier's Civilization 5/Logs/Lua.log"))
REPLAYS_DIR = Path("./replays")

PATTERN = re.compile(r"CIV5_DATA_JSON::(\w+):([^:]+):([^:]+):(.*)")

class ReplayWatcher:
    def __init__(self):
        self.buffers = {}
        self.current_game_id = None
        self.session_file = None
        self.recorded_turns = set() # Чтобы не дублировать ходы в одной сессии
        self._last_size = 0
        
        if not REPLAYS_DIR.exists():
            REPLAYS_DIR.mkdir()

    def process_json(self, data_str):
        try:
            data = json.loads(data_str)
            d_type = data.get("type")
            
            if d_type == "HEADER":
                self.handle_header(data)
            elif d_type == "TURN":
                self.handle_turn(data)
        except json.JSONDecodeError as e:
            # Если JSON битый (например, чанк потерялся), просто пропускаем
            pass

    def handle_header(self, data):
        raw_sig = data.get("signature", "unknown")
        # Очистка сигнатуры для имени папки
        clean_sig = "".join(c for c in raw_sig if c.isalnum() or c in ("-", "_"))[:50]
        
        # Если это та же игра в рамках одного запуска скрипта, не меняем файл
        if self.current_game_id == clean_sig and self.session_file:
            return

        self.current_game_id = clean_sig
        self.recorded_turns.clear()
        
        game_dir = REPLAYS_DIR / self.current_game_id
        game_dir.mkdir(exist_ok=True)

        self.session_file = game_dir / f"session_{int(time.time())}.jsonl"
        self.save_to_session(data)
        
        print(f"\n{'='*50}")
        print(f"[NEW GAME] ID: {self.current_game_id}")
        print(f"[FILE] {self.session_file.name}")
        print(f"{'='*50}")

    def handle_turn(self, data):
        if not self.session_file:
            return
        
        turn = data.get("turn")
        if turn in self.recorded_turns:
            return

        self.recorded_turns.add(turn)
        self.save_to_session(data)
        # Красивый вывод в одну строку
        print(f"[PROGRESS] Записан ход: {turn}    ", end="\r")

    def save_to_session(self, data):
        with open(self.session_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(data, ensure_ascii=False) + "\n")

    def run(self):
        print(f"[*] Мониторинг лога: {LOG_PATH}")
        print("[*] Ожидание данных... (Нажмите 'Следующий ход' в игре)")

        while True:
            if not LOG_PATH.exists():
                time.sleep(1)
                continue

            current_size = os.path.getsize(LOG_PATH)
            
            # Если файл уменьшился — значит игра перезапустилась
            if current_size < self._last_size:
                print("\n[!] Игра перезапущена (лог очищен).")
                self._last_size = 0
                self.buffers.clear()

            if current_size > self._last_size:
                # Открываем в бинарном режиме для seek, но декодируем как utf-8
                with open(LOG_PATH, "rb") as f:
                    f.seek(self._last_size)
                    chunk = f.read(current_size - self._last_size)
                    self._last_size = current_size
                    
                    try:
                        text = chunk.decode("utf-8", errors="ignore")
                        for line in text.splitlines():
                            self.parse_line(line)
                    except Exception as e:
                        print(f"[ERROR] Ошибка чтения: {e}")
            
            time.sleep(0.5)

    def parse_line(self, line):
        # ОТЛАДКА: если видим маркер, сразу печатаем, что нашли
        if "CIV5_DATA_JSON::" in line:
            # print(f"[DEBUG RAW LINE]: {line[:100]}...") # Раскомментируйте для жесткой отладки
            
            match = PATTERN.search(line)
            if match:
                msg_type, uuid, index, payload = match.groups()
                
                if msg_type == "START":
                    # print(f"\n[DEBUG] Поймали START пакета {uuid}")
                    self.buffers[uuid] = []
                elif msg_type == "CHUNK":
                    if uuid in self.buffers:
                        self.buffers[uuid].append(payload)
                elif msg_type == "END":
                    if uuid in self.buffers:
                        full_json = "".join(self.buffers[uuid])
                        self.process_json(full_json)
                        del self.buffers[uuid]
            else:
                # Если маркер есть, но регулярка не сработала — выводим ошибку
                print(f"[ERROR] Линия с маркером не подошла под регулярку: {line[:100]}")

if __name__ == "__main__":
    watcher = ReplayWatcher()
    try:
        watcher.run()
    except KeyboardInterrupt:
        print("\n[*] Завершение работы.")