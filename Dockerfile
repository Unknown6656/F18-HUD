FROM python:3.9-slim
WORKDIR /f18

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY css .
COPY font .
COPY ssl .
COPY js .
COPY offline.js .
COPY server.py .

EXPOSE 180/tcp
EXPOSE 180/udp
CMD ["python", "server.py"]