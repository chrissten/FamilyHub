from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self.rooms: dict[int, list[WebSocket]] = {}

    async def connect(self, room_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self.rooms.setdefault(room_id, []).append(websocket)

    def disconnect(self, room_id: int, websocket: WebSocket) -> None:
        connections = self.rooms.get(room_id)
        if connections and websocket in connections:
            connections.remove(websocket)
            if not connections:
                del self.rooms[room_id]

    async def broadcast(self, room_id: int, html: str) -> None:
        for connection in list(self.rooms.get(room_id, [])):
            try:
                await connection.send_text(html)
            except Exception:
                self.disconnect(room_id, connection)


grocery_manager = ConnectionManager()
todo_manager = ConnectionManager()
