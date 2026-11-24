#!/bin/bash
# X55 Folio — Trình đọc sách EPUB/PDF cho ROCKNIX & PortMaster (Powkiddy X55)

XDG_DATA_HOME=${XDG_DATA_HOME:-$HOME/.local/share}

if [ -d "/opt/system/Tools/PortMaster/" ]; then
  controlfolder="/opt/system/Tools/PortMaster"
elif [ -d "/opt/tools/PortMaster/" ]; then
  controlfolder="/opt/tools/PortMaster"
else
  controlfolder="/roms/ports/PortMaster"
fi

source "$controlfolder/control.txt"
[ -f "${controlfolder}/mod_${CFW_NAME}.txt" ] && source "${controlfolder}/mod_${CFW_NAME}.txt"
get_controls

GAMEDIR="/$directory/ports/x55-folio"
cd "$GAMEDIR" || exit 1

export X55_PORT_DIR="$GAMEDIR"
export SDL_GAMECONTROLLERCONFIG="$sdl_controllerconfig"

# Thư mục mặc định để bạn chép sách .pdf / .epub qua Wi-Fi
if [ -d "/storage/roms/books" ]; then
  export X55_BOOKS_DIR="/storage/roms/books"
elif [ -d "/$directory/books" ]; then
  export X55_BOOKS_DIR="/$directory/books"
else
  mkdir -p "/$directory/books" 2>/dev/null || mkdir -p "$GAMEDIR/books"
  export X55_BOOKS_DIR="$([ -d "/$directory/books" ] && echo "/$directory/books" || echo "$GAMEDIR/books")"
fi

> "$GAMEDIR/log.txt"
exec > >(tee -a "$GAMEDIR/log.txt") 2>&1

$ESUDO chmod 666 /dev/uinput 2>/dev/null || true

EXTRA_FLAGS="--no-sandbox --disable-dev-shm-usage --enable-gamepad-extensions --ignore-gpu-blocklist"

if [ -n "$WAYLAND_DISPLAY" ]; then
  EXTRA_FLAGS="$EXTRA_FLAGS --enable-features=UseOzonePlatform --ozone-platform=wayland"
else
  EXTRA_FLAGS="$EXTRA_FLAGS --ozone-platform-hint=auto"
fi

chmod +x "$GAMEDIR/x55-folio" 2>/dev/null || true

# Hỗ trợ nhấn SELECT+START trên X55 để thoát khẩn cấp nếu cần
if [ -n "$GPTOKEYB" ]; then
  $GPTOKEYB "x55-folio" &
fi

"$GAMEDIR/x55-folio" $EXTRA_FLAGS

if [ -n "$GPTOKEYB" ]; then
  $ESUDO kill -9 $(pidof gptokeyb) 2>/dev/null || true
fi

pm_finish
