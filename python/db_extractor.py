import sqlite3
import json
import os
from pathlib import Path

# === НАСТРОЙКИ ===

# ВАРИАНТ 1: Жестко заданный путь (Самый надежный, так как ты его видишь глазами)
# Обрати внимание на 'r' перед кавычками - это важно для Windows путей
MANUAL_PATH = r"C:\Users\alex-kuruts\Documents\My Games\Sid Meier's Civilization 5\cache\Civ5CoreDatabase.db"

# ВАРИАНТ 2: Автоматика (исправлено на 'Civilization 5')
USER_DOCS = Path(os.path.expanduser("~")) / "Documents" / "My Games" / "Sid Meier's Civilization 5" / "cache" / "Civ5CoreDatabase.db"

OUTPUT_JSON = Path(__file__).parent / "art_defines_dump.json"

def extract_from_db():
    # Логика выбора пути:
    if os.path.exists(MANUAL_PATH):
        db_path = Path(MANUAL_PATH)
        print(f"[*] Использую ручной путь: {db_path}")
    else:
        db_path = USER_DOCS
        print(f"[*] Пробую автоматический путь: {db_path}")

    if not db_path.exists():
        print(f"\n[ERROR] Файл базы данных все еще не найден!")
        print(f"Скрипт искал здесь: {db_path}")
        print("Проверьте переменную MANUAL_PATH в начале скрипта.")
        return

    try:
        # Подключаемся к SQLite
        # uri=True и mode=ro открывают базу в режиме Read-Only, 
        # чтобы не блокировать файл, если игра запущена
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        cursor = conn.cursor()
        
        print("[*] База открыта. Выполняю запрос...")

        # SQL запрос
        query = "SELECT StrategicViewType, Asset FROM ArtDefine_StrategicView"
        
        cursor.execute(query)
        rows = cursor.fetchall()
        
        art_map = {}
        count = 0
        
        for sv_type, asset in rows:
            if sv_type and asset:
                # Нормализация
                clean_asset = asset.lower().replace(".dds", ".png")
                art_map[sv_type] = clean_asset
                count += 1

        print(f"[SUCCESS] Извлечено {count} записей из базы данных.")
        
        # Сохраняем в JSON
        with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
            json.dump(art_map, f, indent=2, ensure_ascii=False)
            
        print(f"Словарь сохранен в: {OUTPUT_JSON}")
        
        conn.close()

    except sqlite3.OperationalError as e:
        print(f"[ERROR] Ошибка SQL: {e}")
        print("Подсказка: Если пишет 'database is locked', закройте игру полностью.")
    except Exception as e:
        print(f"[ERROR] Неизвестная ошибка: {e}")

if __name__ == "__main__":
    extract_from_db()