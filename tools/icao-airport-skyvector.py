import os
import os.path
import re
import requests
import lxml.html as lh


HOST_URL = 'https://skyvector.com'
LINK_PREFIX_LIST = '/airports/'
LINK_PREFIX_AIRPORT = '/airport/'
BASE_URL = f'{HOST_URL}{LINK_PREFIX_LIST}'
FILE_AIRPORT_LINKS = './tools/airport-urls.log'
FILE_AIRPORTS = './js/airports.js'

RE_COORDS : re.Pattern[str] = re.compile(r'coordinates\s*:\s*(?P<lat>[NS][-+]?\d+\s*°(\s*\d+(.\d+)?\s*\')?(\s*\d+(.\d+)?\s*\")?)\s*[,/]\s*(?P<lon>[EWO][-+]?\d+\s*°(\s*\d+(.\d+)?\s*\')?(\s*\d+(.\d+)?\s*\")?)\s*\n', re.I)
RE_ALT : re.Pattern[str] = re.compile(r'(?P<alt>[-+]?\d+(.\d+)?)\s+f(ee|oo|)t\s+msl', re.I)
RE_DEGR : re.Pattern[str] = re.compile(r'(?P<dir>[NWESO])?\s*(?P<deg>\d+)\s*°(\s*(?P<min>\d+(.\d+))\')?\s*(\s*(?P<sec>\d+(.\d+))\")?\s*', re.I)



def get_links(url : str) -> tuple[list[str], list[str]]:
    response = requests.get(url)
    links : list[str] = []
    airports : list[str] = []

    if response.status_code == 200:
        doc : lh.HtmlElement = lh.fromstring(response.content, url)

        for link in doc.xpath('//a/@href'):
            if '?' in link:
                link = link[:link.index('?')]

            if link.startswith(LINK_PREFIX_AIRPORT):
                airports.append(HOST_URL + link)
            elif link.startswith(LINK_PREFIX_LIST):
                links.append(HOST_URL + link)

    return links, airports

def get_links_recursive() -> list[str]:
    if os.path.exists(FILE_AIRPORT_LINKS):
        with open(FILE_AIRPORT_LINKS, 'r') as fp:
            return [line.strip() for line in fp.readlines()]
    else:
        with open(FILE_AIRPORT_LINKS, 'w') as fp:
            urls : set[str] = set()
            undiscovered : set[str] = set([BASE_URL])
            all_airports : set[str] = set()

            while len(undiscovered) > 0:
                url = undiscovered.pop()
                urls.add(url)

                print(f'[{len(urls):6}, {len(undiscovered):6}, {len(all_airports):6}] {url}')

                links, airports = get_links(url)

                for airport in airports:
                    if airport in all_airports:
                        continue
                    all_airports.add(airport)
                    fp.write(f'{airport}\n')

                fp.flush()

                for link in links:
                    if link not in urls:
                        undiscovered.add(link)

            return list(all_airports)

def parse_degrees(degr : str) -> float:
    match : dict[str] = RE_DEGR.match(degr).groupdict()
    deg = int(match['deg'])
    min = float(match['min'] or 0)
    sec = float(match['sec'] or 0)

    if (match['dir'] or 'N') in 'SW':
        deg = -deg
        min = -min
        sec = -sec

    return deg + min / 60 + sec / 3600

def parse_airport(url : str) -> dict[str, str] | None:
    if (response := requests.get(url)).status_code == 200:
        doc : lh.HtmlElement = lh.fromstring(response.content, url)
        aptdata : str = '\n'.join(doc.xpath('//*[@id="aptdata"]/div/div/text()'))
        airport : dict[str, str] = {
            'name': doc.xpath('//*[@id="titlebgright"]/text()')[0],
            'icao': doc.xpath('//*[@id="titlebgleftg"]/text()')[0],
        }

        for match in (match.groupdict() for match in RE_COORDS.finditer(aptdata)):
            airport['lat'] = parse_degrees(match['lat'])
            airport['lon'] = parse_degrees(match['lon'])
            # print(f'    {match["lat"]},{match["lon"]} -> {airport["lat"]},{airport["lon"]}')
            break

        for match in (match.groupdict() for match in RE_ALT.finditer(aptdata)):
            airport['alt'] = match['alt']
            break

        return airport


os.chdir(os.path.dirname(__file__) + '/..')

with open(FILE_AIRPORTS, 'w') as fp:
    fp.write('const airports={')

    for url in get_links_recursive():
        if airport := parse_airport(url):
            print(f'{airport["name"]} ({airport["icao"]}): {airport["lat"]}, {airport["lon"]}, {airport["alt"]}')

            fp.write(f'''"{airport["icao"]}":{'{'}"name":"{airport["name"]}","lat":{airport["lat"]},"lon":{airport["lon"]},"alt":{airport["alt"]},{'}'},''')
            fp.flush()

    fp.write('};')
