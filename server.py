#!/usr/bin/env python3

import datetime
import ssl
import os

from flask import Flask, send_file



CURRENT_DIR : str = os.path.dirname(os.path.abspath(__file__))
ALLOWED_EXTENSIONS : set[str] = { '.html', '.js', '.css', '.eot', '.ttf', '.woff', '.woff2', '.otf', '.png', '.jpg', 'jpeg' }
SERVER_SSL_DIR : str = os.path.join(CURRENT_DIR, 'ssl')
SERVER_PUB_KEY : str = os.path.join(SERVER_SSL_DIR, 'server.pem')
SERVER_SEC_KEY : str = os.path.join(SERVER_SSL_DIR, 'server.key')
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

def get_ssl_context(cnames : list[str]) -> ssl.SSLContext:
    if not os.path.exists(SERVER_SSL_DIR):
        os.makedirs(SERVER_SSL_DIR)

    if not os.path.exists(SERVER_PUB_KEY) or not os.path.exists(SERVER_SEC_KEY):
        from cryptography import x509
        from cryptography.hazmat.backends import default_backend
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID
        from cryptography.x509.base import Certificate

        cnames.append('*')

        backend = default_backend()
        pkey : rsa.RSAPrivateKey = rsa.generate_private_key(65537, 2048, backend)
        subject = x509.Name([
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, 'Unknown6656'),
            x509.NameAttribute(NameOID.COMMON_NAME, '*'),
        ])
        now = datetime.datetime.now(datetime.timezone.utc)
        cert: Certificate = (
            x509.CertificateBuilder()
                .subject_name(subject)
                .issuer_name(subject)
                .public_key(pkey.public_key())
                .serial_number(x509.random_serial_number())
                .not_valid_before(now)
                .not_valid_after(now + datetime.timedelta(days = 3650))
                .add_extension(x509.ExtendedKeyUsage([
                    x509.OID_SERVER_AUTH,
                    x509.OID_CLIENT_AUTH,
                ]), False)
                .add_extension(x509.SubjectAlternativeName(
                    [x509.DNSName(cn) for cn in set(cnames)] +
                    [x509.DNSName(f'*.{cn}') for cn in set(cnames)]
                ), False)
                .sign(pkey, hashes.SHA256(), backend)
        )

        with open(SERVER_PUB_KEY, 'wb') as cert_file:
            cert_file.write(cert.public_bytes(serialization.Encoding.PEM))

        with open(SERVER_SEC_KEY, 'wb') as pkey_file:
            pkey_file.write(pkey.private_bytes(
                encoding = serialization.Encoding.PEM,
                format = serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm = serialization.NoEncryption(),
            ))

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(SERVER_PUB_KEY, SERVER_SEC_KEY)

    return ctx



if __name__ == '__main__':
    os.chdir(CURRENT_DIR)

    app.run(
        '0.0.0.0',
        180,
        False,
        ssl_context = get_ssl_context(['localhost'])
    )
