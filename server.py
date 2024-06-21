import os

from flask import Flask, send_file, request, jsonify



CURRENT_DIR : str = os.path.dirname(os.path.abspath(__file__))
ALLOWED_EXTENSIONS : set[str] = { '.html', '.js', '.css', '.eot', '.ttf', '.woff', '.woff2', '.otf', '.png', '.jpg', 'jpeg' }
SERVER_PUB_CER : str = os.path.join(CURRENT_DIR, 'ssl', 'server.cer')
SERVER_PUB_KEY : str = os.path.join(CURRENT_DIR, 'ssl', 'server.pem')
SERVER_SEC_KEY : str = os.path.join(CURRENT_DIR, 'ssl', 'server.key')
SERVER_HOSTNAME = 'localhost'

app = Flask(__name__)


@app.route('/<path:path>')
def route_static(path : str):
    allowed = False

    for ext in ALLOWED_EXTENSIONS:
        if path.endswith(ext):
            allowed = True
            if os.path.exists(path):
                return send_file(path), 200

    return (f'"{path}" not found', 404) if allowed else (f'"{path}" not allowed', 403)

@app.route('/')
def route_index():
    return route_static('index.html')


if __name__ == '__main__':
    os.chdir(CURRENT_DIR)

    app.run(
        '0.0.0.0',
        180,
        False,
        ssl_context = 'adhoc'
    )
