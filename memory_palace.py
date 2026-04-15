# memory_palace.py — ChromaDB semantic memory for IBIS/Zorian
import chromadb
import json
import sys
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "memory")
client = chromadb.PersistentClient(path=DB_PATH)
collection = client.get_or_create_collection(
    name="ibis_memory",
    metadata={"hnsw:space": "cosine"}
)

def store(key, text, tags="general"):
    doc_id = key.strip().lower().replace(" ", "_")[:64]
    metadata = {
        "tags": tags,
        "date": datetime.now().isoformat(),
        "key": doc_id
    }
    collection.upsert(
        documents=[text],
        metadatas=[metadata],
        ids=[doc_id]
    )
    return f"Stored: {doc_id}"

def search(query, n=5):
    results = collection.query(
        query_texts=[query],
        n_results=min(n, collection.count())
    )
    if not results["documents"][0]:
        return "No memories found."
    out = []
    for doc, meta in zip(results["documents"][0], results["metadatas"][0]):
        out.append(f"[{meta.get('key','?')}] {doc[:200]}")
    return "\n---\n".join(out)

def list_all(limit=20):
    results = collection.get(limit=limit)
    if not results["documents"]:
        return "Memory palace is empty."
    out = []
    for doc, meta in zip(results["documents"], results["metadatas"]):
        out.append(f"• [{meta.get('key','?')}] ({meta.get('tags','')}) {doc[:100]}")
    return "\n".join(out)

def count():
    return f"Memory palace contains {collection.count()} memories."

# CLI interface for Node.js to call
if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
    if cmd == "store":
        key = sys.argv[2]
        text = sys.argv[3]
        tags = sys.argv[4] if len(sys.argv) > 4 else "general"
        print(store(key, text, tags))
    elif cmd == "search":
        query = sys.argv[2]
        print(search(query))
    elif cmd == "list":
        print(list_all())
    elif cmd == "count":
        print(count())
    else:
        print("Commands: store <key> <text> <tags> | search <query> | list | count")
