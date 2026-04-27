import os
import glob

# The directory containing the built Vite application files
BUILD_DIR = 'artifacts/sticker-studio/dist/public'

# The mapping from placeholders to actual environment variable values (usually from GitHub Secrets)
secrets_mapping = {
    '__FIREBASE_API_KEY__': os.environ.get('VITE_FIREBASE_API_KEY', ''),
    '__FIREBASE_AUTH_DOMAIN__': os.environ.get('VITE_FIREBASE_AUTH_DOMAIN', ''),
    '__FIREBASE_PROJECT_ID__': os.environ.get('VITE_FIREBASE_PROJECT_ID', ''),
    '__FIREBASE_STORAGE_BUCKET__': os.environ.get('VITE_FIREBASE_STORAGE_BUCKET', ''),
    '__FIREBASE_MESSAGING_SENDER_ID__': os.environ.get('VITE_FIREBASE_MESSAGING_SENDER_ID', ''),
    '__FIREBASE_APP_ID__': os.environ.get('VITE_FIREBASE_APP_ID', ''),
}

def inject_secrets():
    # Find all JS and HTML files in the dist folder
    files = glob.glob(f'{BUILD_DIR}/**/*.js', recursive=True) + glob.glob(f'{BUILD_DIR}/**/*.html', recursive=True)
    
    for filepath in files:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        modified = False
        for placeholder, secret_value in secrets_mapping.items():
            if secret_value and placeholder in content:
                content = content.replace(placeholder, secret_value)
                modified = True
                
        if modified:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"Injecting secrets into {filepath}...")

if __name__ == '__main__':
    print("Starting secret injection process...")
    inject_secrets()
    print("Secrets injection completed.")
