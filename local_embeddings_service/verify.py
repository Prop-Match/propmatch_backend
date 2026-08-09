"""Verify persistent Chroma indexing and querying with supplied vectors."""

from app import COLLECTION_NAME, get_collection

documents = [
    "شقة للإيجار في المنصورة، غرفتين وقريبة من الجامعة",
    "شقة مفروشة في القاهرة الجديدة، ثلاث غرف",
]
ids = ["verify-mansoura", "verify-cairo"]
embeddings = [
    [1.0, 0.0, 0.0],
    [0.0, 1.0, 0.0],
]

assert embeddings and all(isinstance(value, float) for value in embeddings[0])
collection = get_collection()
collection.upsert(
    ids=ids,
    documents=documents,
    embeddings=embeddings,
    metadatas=[{"city": "المنصورة"}, {"city": "القاهرة الجديدة"}],
)

query_embedding = [0.99, 0.01, 0.0]
result = collection.query(
    query_embeddings=[query_embedding],
    n_results=2,
    include=["documents", "metadatas", "distances"],
)

assert result["ids"] and result["ids"][0]
print(f"collection={COLLECTION_NAME}")
print(f"embedding_dimension={len(embeddings[0])}")
print(f"numeric_embedding={all(isinstance(value, float) for value in embeddings[0])}")
print(f"top_result={result['ids'][0][0]}")

collection.delete(ids=ids)
