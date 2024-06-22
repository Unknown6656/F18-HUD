import requests
import json
import csv
import os


DOWNLOAD_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv'
PATH_CSV = 'tools/airports.csv'
PATH_JS = 'js/airports.js'
COLUMNS = ("id","icao","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","gps_code","iata_code","local_code","home_link","wikipedia_link","keywords")
IGNORE = ['duplicate', '(spam)', '(mischief)', '(test)', '(sandbox)', 'non-existant']


os.chdir(os.path.dirname(__file__) + '/..')

if not os.path.exists(PATH_CSV):
    response = requests.get(DOWNLOAD_URL)

    with open(PATH_CSV, 'wb') as f_csv:
        f_csv.write(response.content)

with open(PATH_CSV, 'r', encoding="utf-8-sig") as f_csv:
    with open(PATH_JS, 'w', encoding="utf-8-sig") as f_js:
        f_js.write('// THIS IS AUTO-GENERATED\nconst airports={\n')
        first = True
        unique_wgs84 = set()

        for row in csv.DictReader(f_csv, COLUMNS):
            if first:
                first = False
            else:
                lat : str = row['latitude_deg'] or 'NaN'
                lon : str = row['longitude_deg'] or 'NaN'
                alt : str = row['elevation_ft'] or '0'
                name : str = row['name'].replace('"', '\\"')

                if lat == 'NaN' or lon == 'NaN':
                    continue
                elif any((ignore in name.lower()) for ignore in IGNORE):
                    continue
                elif name.lower() == 'spam':
                    continue
                elif (lat, lon) in unique_wgs84:
                    continue
                else:
                    unique_wgs84.add((lat, lon))
                    f_js.write(f'"{row["icao"]}":{{"name":"{name}","lat":{lat},"lon":{lon},"alt":{alt},"country":"{row["iso_country"] or "XX"}","region":"{row["iso_region"] or "XX-XX"}"}},\n')

        f_js.write('};\n')