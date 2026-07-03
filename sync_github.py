import urllib.request
import urllib.error
import json
import os
import sys
from dulwich.repo import Repo
import dulwich.porcelain as porcelain

PAT = os.environ.get("GITHUB_PAT", "REDACTED")
REPO_NAME = "GodlikeGitControl"
REPO_PATH = os.path.dirname(os.path.abspath(__file__))

def get_github_username(pat):
    url = "https://api.github.com/user"
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {pat}")
    req.add_header("Accept", "application/vnd.github.v3+json")
    req.add_header("User-Agent", "Antigravity-Agent")
    
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode('utf-8'))
            return data["login"]
    except Exception as e:
        print(f"[-] Error fetching user info: {e}")
        sys.exit(1)

def create_github_repo(pat, name):
    url = "https://api.github.com/user/repos"
    body = {
        "name": name,
        "private": False,
        "description": "A cinematic gold themed git controller and system monitor app"
    }
    data_bytes = json.dumps(body).encode('utf-8')
    
    req = urllib.request.Request(url, data=data_bytes, method="POST")
    req.add_header("Authorization", f"Bearer {pat}")
    req.add_header("Accept", "application/vnd.github.v3+json")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "Antigravity-Agent")
    
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode('utf-8'))
            print(f"[+] Public repository '{name}' created successfully on GitHub!")
            return data["html_url"]
    except urllib.error.HTTPError as e:
        if e.code == 422:
            print(f"[!] Repository '{name}' already exists on GitHub. Proceeding with existing repository...")
            return None
        else:
            print(f"[-] HTTP Error creating repository: {e.code} - {e.read().decode('utf-8')}")
            sys.exit(1)
    except Exception as e:
        print(f"[-] Error creating repository: {e}")
        sys.exit(1)

def sync_repo():
    if not PAT or PAT == "REDACTED":
        print("[-] Error: GITHUB_PAT environment variable is not set.")
        print("[!] Please set GITHUB_PAT before running this script.")
        sys.exit(1)
    print("[+] Fetching GitHub username...")
    username = get_github_username(PAT)
    print(f"[+] Authenticated as GitHub user: {username}")

    print("[+] Creating public repository on GitHub...")
    repo_url = create_github_repo(PAT, REPO_NAME)
    if not repo_url:
        repo_url = f"https://github.com/{username}/{REPO_NAME}"
    
    print(f"[+] Target Repository URL: {repo_url}")
    
    # Configure git remote
    r = Repo(REPO_PATH)
    config = r.get_config()
    
    # Standard remote settings
    config.set((b'remote', b'origin'), b'url', repo_url.encode('utf-8'))
    config.set((b'remote', b'origin'), b'fetch', b'+refs/heads/*:refs/remotes/origin/*')
    config.write_to_path()
    print("[+] Configured remote origin URL.")
    
    # Git Push using PAT token for authentication
    # Target URL with authentication embedded: https://<username>:<token>@github.com/<username>/<repo>.git
    authenticated_url = f"https://{username}:{PAT}@github.com/{username}/{REPO_NAME}.git"
    
    print("[+] Pushing local 'master' branch to remote 'main' branch on GitHub...")
    try:
        # Pushes local refs/heads/master to remote refs/heads/main
        porcelain.push(r, authenticated_url, b'refs/heads/master:refs/heads/main')
        print("[+] Sync complete! Code successfully published to main branch.")
        print(f"[+] View your repository here: {repo_url}")
    except Exception as e:
        print(f"[-] Push failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    sync_repo()
