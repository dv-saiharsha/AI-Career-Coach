# Ollama with its models baked in, for a Cloud Run GPU service.
#
# Baking the weights into the image (rather than pulling at startup) makes a
# cold start a container start, not a multi-GB download, and pins exactly
# which model versions the app was tested against.
ARG OLLAMA_VERSION=0.24.0
FROM ollama/ollama:${OLLAMA_VERSION}

# MODEL_LIST, not OLLAMA_MODELS: that name is Ollama's model *directory*.
ARG MODEL_LIST="llama3.1 qwen2.5:14b nomic-embed-text"
ENV OLLAMA_HOST=0.0.0.0:8080 \
    OLLAMA_MODELS=/models \
    # Keep a loaded model in GPU memory for the life of the instance; Cloud
    # Run scaling to zero is what releases it.
    OLLAMA_KEEP_ALIVE=-1

RUN ollama serve & pid=$! \
    && sleep 5 \
    && for m in ${MODEL_LIST}; do ollama pull "$m" || exit 1; done \
    && kill "$pid"

ENTRYPOINT ["ollama", "serve"]
