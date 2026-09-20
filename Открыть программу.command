#!/bin/bash
#
# Двойной клик по этому файлу открывает программу.
#
# Просто открыть dist/index.html в браузере нельзя: программа состоит из
# ES-модулей, веб-воркеров и WASM, а браузер запрещает их загрузку с диска
# (протокол file://) — получится пустой чёрный экран. Поэтому здесь
# поднимается локальный сервер и браузер открывается уже на нём.
#
# Сервер живёт, пока открыто это окно Терминала. Закрыть окно — закрыть
# программу.

set -e

cd "$(dirname "$0")"

# Finder запускает .command не через обычную оболочку, поэтому node может
# оказаться вне PATH.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

if ! command -v npm >/dev/null 2>&1; then
  echo "Не найден Node.js — программа без него не запустится."
  echo "Установите его с https://nodejs.org и запустите этот файл снова."
  echo
  read -r -p "Нажмите Enter, чтобы закрыть..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Первый запуск: устанавливаю зависимости, это займёт пару минут..."
  npm install
fi

# Пересобираем, если сборки нет или исходники новее её.
if [ ! -f dist/index.html ] || [ -n "$(find src index.html -newer dist/index.html -print -quit 2>/dev/null)" ]; then
  echo "Собираю программу..."
  npm run build
fi

echo
echo "Программа открывается в браузере: http://localhost:4173"
echo "Чтобы закрыть программу — закройте это окно."
echo

# Браузеру нужно время, пока сервер поднимется.
( sleep 2; open "http://localhost:4173" ) &

npm run preview -- --port 4173
