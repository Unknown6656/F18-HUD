import requests
import json
import csv
import os


DOWNLOAD_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv'
PATH_CSV = 'tools/airports.csv'
PATH_JS = 'js/airports.js'
COLUMNS = ("id","icao","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","gps_code","iata_code","local_code","home_link","wikipedia_link","keywords")


os.chdir(os.path.dirname(__file__) + '/..')

if not os.path.exists(PATH_CSV):
    response = requests.get(DOWNLOAD_URL)

    with open(PATH_CSV, 'wb') as f_csv:
        f_csv.write(response.content)

with open(PATH_CSV, 'r', encoding="utf-8-sig") as f_csv:
    with open(PATH_JS, 'w', encoding="utf-8-sig") as f_js:
        f_js.write('// THIS IS AUTO-GENERATED\nconst airports={\n')
        first = True

        for row in csv.DictReader(f_csv, COLUMNS):
            if first:
                first = False
            else:
                f_js.write(f'"{row["icao"]}":{{"name":"{row["name"]}","lat":{row["latitude_deg"] or 0},"lon":{row["longitude_deg"] or 0},"alt":{row["elevation_ft"] or 0},"country":"{row["iso_country"]}","region":"{row["iso_region"]}"}},\n')

        f_js.write('};\n')