"""Verify local Arabic embedding, persistent Chroma indexing, and querying."""

from app import COLLECTION_NAME, MODEL_NAME, encode, get_collection

documents = [
    "شقة للإيجار في المنصورة، غرفتين وقريبة من الجامعة",
    "شقة مفروشة في القاهرة الجديدة، ثلاث غرف",
]
ids = ["verify-mansoura", "verify-cairo"]
embeddings = encode(documents)

assert embeddings and all(isinstance(value, float) for value in embeddings[0])
collection = get_collection()
collection.upsert(
    ids=ids,
    documents=documents,
    embeddings=embeddings,
    metadatas=[{"city": "المنصورة"}, {"city": "القاهرة الجديدة"}],
)

query_embedding = encode(["أبحث عن شقة غرفتين بالقرب من الجامعة"])[0]
result = collection.query(
    query_embeddings=[query_embedding],
    n_results=2,
    include=["documents", "metadatas", "distances"],
)

assert result["ids"] and result["ids"][0]
print(f"model={MODEL_NAME}")
print(f"collection={COLLECTION_NAME}")
print(f"embedding_dimension={len(embeddings[0])}")
print(f"numeric_embedding={all(isinstance(value, float) for value in embeddings[0])}")
print(f"top_result={result['ids'][0][0]}")
