# Local dev only: serve play.pokemonshowdown.com/ with caching disabled, so edits to mgb/*.js
# always reach the browser. Usage: python3 vendor/showdown-client/mgb/dev-static-server.py [port]
import http.server, os, sys
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'play.pokemonshowdown.com')
os.chdir(root)
class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
http.server.ThreadingHTTPServer(('127.0.0.1', port), NoCache).serve_forever()
