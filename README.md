# Fitness Record v1.5.0 Cloud Sync

Run with `python3 -m http.server 8000` and open `http://localhost:8000`.

The published app saves locally for offline use and synchronizes workout data and exercise photos through the authenticated Fitness Record Supabase project. Local edits sync after a 15-second quiet period, and newer local edits are protected from in-flight responses. On first activation, initialize the cloud only from the computer browser containing the official data.

Manual JSON export/import controls were removed. Computer, iPhone, and iPad can all edit; record-level metadata merges changes made on different devices.
