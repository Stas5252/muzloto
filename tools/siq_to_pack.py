#!/usr/bin/env python3
"""Convert SIGame .siq packages into packs for the «Вне очереди» quiz.

Usage: python3 tools/siq_to_pack.py titles.json file1.siq file2.siq ...
titles.json maps a .siq file name to {"id": "slug", "title": "...", "description": "..."}.
Needs Pillow and ffmpeg. Writes quiz/packs/<id>.json, quiz/packs/index.json and quiz/packs/media/.
"""
import hashlib, io, json, os, re, subprocess, sys, tempfile, urllib.parse, zipfile
import xml.etree.ElementTree as ET
from PIL import Image, ImageStat

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'quiz', 'packs')
MEDIA = os.path.join(OUT, 'media')
FOLDERS = {'image': 'Images', 'audio': 'Audio', 'video': 'Video'}
JURY = 'Оценивает ведущий'
tag = lambda node: re.sub(r'\{.*?\}', '', node.tag)
kids = lambda node, name: [child for child in node if tag(child) == name]
text = lambda value: re.sub(r'[ \t]+', ' ', (value or '').replace('\r', '')).strip()


def save(data, extension):
    name = hashlib.sha1(data).hexdigest()[:12] + extension
    path = os.path.join(MEDIA, name)
    if not os.path.exists(path):
        with open(path, 'wb') as file:
            file.write(data)
    return 'packs/media/' + name


def opaque(image):
    # A dark drawing on a transparent background gets a white sheet, a light one a dark sheet: dropping alpha left it invisible.
    rgba = image.convert('RGBA')
    alpha = rgba.getchannel('A')
    if alpha.getextrema()[0] == 255:
        return image.convert('RGB')
    light = ImageStat.Stat(rgba.convert('L'), alpha.point(lambda value: 255 if value > 127 else 0)).mean[0] > 200
    return Image.alpha_composite(Image.new('RGBA', rgba.size, (16, 18, 28, 255) if light else 'white'), rgba).convert('RGB')


def picture(blobs):
    images = [opaque(Image.open(io.BytesIO(blob))) for blob in blobs]
    if len(images) > 1:
        height = min(image.height for image in images)
        images = [image.resize((round(image.width * height / image.height), height)) for image in images]
        sheet = Image.new('RGB', (sum(image.width for image in images) + 16 * (len(images) - 1), height), 'white')
        left = 0
        for image in images:
            sheet.paste(image, (left, 0))
            left += image.width + 16
        images = [sheet]
    image = images[0]
    image.thumbnail((1000, 1000))
    out = io.BytesIO()
    image.save(out, 'WEBP', quality=72, method=6)
    return save(out.getvalue(), '.webp')


def sound(blob):
    with tempfile.TemporaryDirectory() as folder:
        source, target = os.path.join(folder, 'in'), os.path.join(folder, 'out.mp3')
        with open(source, 'wb') as file:
            file.write(blob)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', source, '-vn', '-ac', '2', '-b:a', '96k', target], check=True)
        with open(target, 'rb') as file:
            return save(file.read(), '.mp3')


def convert(path, meta):
    archive = zipfile.ZipFile(path)
    files = {urllib.parse.unquote(info.filename): info for info in archive.infolist()}
    root = ET.fromstring(archive.read('content.xml').decode('utf-8-sig'))

    def content(param):
        words, images, audio = [], [], ''
        for item in kids(param, 'item') if param is not None else []:
            kind = item.get('type') or 'text'
            if kind == 'text':
                words.append(text(item.text))
            elif item.get('isRef') == 'True' and kind in FOLDERS:
                blob = archive.read(files[FOLDERS[kind] + '/' + item.text])
                if kind == 'image':
                    images.append(blob)
                elif kind == 'audio':
                    audio = sound(blob)
        return '\n'.join(word for word in words if word), picture(images) if images else '', audio

    def question(node, theme, value):
        params = {param.get('name'): param for param in kids(kids(node, 'params')[0], 'param')}
        prompt, image, audio = content(params.get('question'))
        shown, answer_image, answer_audio = content(params.get('answer'))
        answers = [text(answer.text) for right in kids(node, 'right') for answer in kids(right, 'answer')]
        answers = [answer for answer in answers if answer]
        if 'answerOptions' in params:
            options = {option.get('name'): content(option)[0] for option in kids(params['answerOptions'], 'param')}
            prompt += '\n' + '\n'.join(f'{letter}) {option}' for letter, option in options.items())
            answers = [f'{answer}) {options[answer]}' if answer in options else answer for answer in answers]
        answer = ' / '.join(answers) or shown or JURY
        if shown and shown not in answer:
            answer += ' — ' + shown
        result = {'value': value, 'prompt': prompt or theme, 'answer': answer}
        for key, item in (('image', image), ('audio', audio), ('answerImage', answer_image), ('answerAudio', answer_audio)):
            if item:
                result[key] = item
        if node.get('type') == 'secret':
            result['kind'] = 'handoff'
        return result

    rounds, finals = [], []
    for stage in [node for node in root.iter() if tag(node) == 'round']:
        themes = [(text(theme.get('name')), [q for q in theme.iter() if tag(q) == 'question'])
                  for theme in stage.iter() if tag(theme) == 'theme']
        if stage.get('type') == 'final':
            for title, questions in themes:
                item = question(questions[0], title, 0)
                del item['value']
                item.pop('kind', None)
                finals.append({'topic': title, **item})
            continue
        step = 100 * (len(rounds) + 1)
        rounds.append({'title': f'Раунд {len(rounds) + 1}', 'note': '', 'categories': [
            {'title': title, 'questions': [question(node, title, int(node.get('price') or 0) or step * (i + 1))
                                           for i, node in enumerate(questions)]}
            for title, questions in themes if questions]})
    pack = {'title': meta['title'], 'rounds': rounds, 'finals': finals}
    with open(os.path.join(OUT, meta['id'] + '.json'), 'w', encoding='utf-8') as file:
        json.dump(pack, file, ensure_ascii=False, separators=(',', ':'))
    count = sum(len(category['questions']) for stage in rounds for category in stage['categories'])
    return {'id': meta['id'], 'title': meta['title'], 'description': meta['description'],
            'questions': count, 'finals': len(finals),
            'themes': [[category['title'] for category in stage['categories']] for stage in rounds]}


def main():
    os.makedirs(MEDIA, exist_ok=True)
    with open(sys.argv[1], encoding='utf-8') as file:
        titles = json.load(file)
    index = []
    for path in sys.argv[2:]:
        meta = titles[os.path.basename(path)]
        index.append(convert(path, meta))
        print(index[-1])
    index.sort(key=lambda item: [name['id'] for name in titles.values()].index(item['id']))
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as file:
        json.dump(index, file, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
