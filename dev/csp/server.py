# Serves a directory and applies the "/*" block of its _headers file, like Cloudflare Pages.
import http.server, sys, os, functools
root, port = sys.argv[1], int(sys.argv[2])
hdrs, on = [], False
for ln in open(os.path.join(root, '_headers')):
    if ln.startswith('#') or not ln.strip(): continue
    if not ln[0].isspace(): on = ln.strip() == '/*'; continue
    if on: k, v = ln.strip().split(':', 1); hdrs.append((k, v.strip()))
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        for k, v in hdrs: self.send_header(k, v)
        super().end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(H, directory=root)).serve_forever()
