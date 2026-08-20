#!/usr/bin/env python3
"""Build a map-ready COIN+ store dataset from the official CSV snapshot.

Source: https://coinplus.jp/assets/csv/storesearch/all_shop_list.js
The target scope is Kyoto City, Osaka City, Ibaraki City, and Takatsuki City.
"""

import csv
import json
import argparse
from collections import Counter
from datetime import date
from pathlib import Path

SOURCE = Path('/home/ubuntu/official_all_shop_list.js')
OUTPUT = Path('/home/ubuntu/coin_plus_map/client/public/stores.json')

CATEGORY_NAMES = {
    '1': 'コンビニ・スーパー・デパート',
    '2': '飲食店（和食）',
    '3': '飲食店（イタリアン・フレンチ・洋食）',
    '4': '飲食店（カフェ・スイーツ）',
    '5': '飲食店（居酒屋）',
    '6': '飲食店（その他）',
    '7': 'ショッピング',
    '8': '薬局',
    '9': '医療・健康サービス',
    '10': 'ファッション',
    '11': '美容院・理容店',
    '12': 'ビューティー・リラク',
    '13': 'レジャー・スポーツ・旅行',
    '14': '住まい・暮らし',
    '15': '趣味・教育・習い事',
    '16': 'その他',
}


def scope_label(prefecture: str, city: str) -> str | None:
    if prefecture == '大阪府' and city.startswith('大阪市'):
        return '大阪市'
    if prefecture == '京都府' and city.startswith('京都市'):
        return '京都市'
    if prefecture == '大阪府' and city == '茨木市':
        return '茨木市'
    if prefecture == '大阪府' and city == '高槻市':
        return '高槻市'
    return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Build a COIN+ map dataset from the official CSV snapshot.')
    parser.add_argument('--source', type=Path, default=SOURCE, help='Source CSV path.')
    parser.add_argument('--output', type=Path, default=OUTPUT, help='Output JSON path.')
    parser.add_argument('--source-snapshot', default=date.today().isoformat(), help='ISO date for the source snapshot.')
    parser.add_argument('--coordinates', type=Path, help='Optional coordinate cache JSON created by geocode_store_dataset.py.')
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.source.exists():
        raise FileNotFoundError(f'Missing source file: {args.source}')

    coordinate_cache = {}
    if args.coordinates:
        if not args.coordinates.exists():
            raise FileNotFoundError(f'Missing coordinate cache: {args.coordinates}')
        coordinate_payload = json.loads(args.coordinates.read_text(encoding='utf-8'))
        coordinate_cache = coordinate_payload.get('coordinates', {})

    stores = []
    seen = set()

    with args.source.open('r', encoding='utf-8-sig', newline='') as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            name = (row.get('name') or '').strip()
            prefecture = (row.get('prefecture') or '').strip()
            city = (row.get('city') or '').strip()
            address = (row.get('address') or '').strip()
            category_id = (row.get('category') or '').strip()
            area = scope_label(prefecture, city)

            if not area or not name or not address:
                continue

            full_address = f'{prefecture}{address}'
            key = (name, full_address, category_id)
            if key in seen:
                continue
            seen.add(key)

            store = {
                'id': f'coinplus-{len(stores) + 1}',
                'name': name,
                'address': full_address,
                'prefecture': prefecture,
                'city': city,
                'area': area,
                'genre': CATEGORY_NAMES.get(category_id, 'その他'),
                'categoryId': category_id,
            }
            coordinate = coordinate_cache.get(full_address)
            if coordinate:
                store.update({
                    'latitude': coordinate['latitude'],
                    'longitude': coordinate['longitude'],
                    'geocodeLevel': coordinate.get('geocodeLevel'),
                })
            stores.append(store)

    stores.sort(key=lambda item: (item['area'], item['city'], item['name'], item['address']))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(
            {
                'source': 'https://coinplus.jp/storesearch/all.html',
                'sourceSnapshot': args.source_snapshot,
                'scope': ['京都市', '大阪市', '茨木市', '高槻市'],
                'stores': stores,
            },
            ensure_ascii=False,
            separators=(',', ':'),
        ),
        encoding='utf-8',
    )

    counts = Counter(item['area'] for item in stores)
    coordinates_count = sum(1 for item in stores if 'latitude' in item and 'longitude' in item)
    print('Total stores:', len(stores))
    print('Stores with coordinates:', coordinates_count)
    for area in ['京都市', '大阪市', '茨木市', '高槻市']:
        print(f'{area}: {counts[area]}')


if __name__ == '__main__':
    main()
