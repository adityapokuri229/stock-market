import json

def scrub():
    with open('game_data.json', 'r') as f:
        data = json.load(f)
    
    # Scrub factor and score from news drops
    for row in data.get('rows', []):
        for news in row.get('news', []):
            if 'factor' in news:
                del news['factor']
            if 'score' in news:
                del news['score']
    
    with open('game_data_public.json', 'w') as f:
        json.dump(data, f, separators=(',', ':'))
        
    print("Generated game_data_public.json successfully.")

if __name__ == '__main__':
    scrub()
