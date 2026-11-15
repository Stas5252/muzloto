const fs = require('fs');

const PACK_DEFS = {
  rock: {
    id: 'rock',
    title: 'Русский Рок & Легенды',
    icon: '🎸',
    desc: 'Культовые гитарные риффы и песни, которые поёт вся страна',
    queries: [
      'Кино Группа крови',
      'Король и Шут Лесник',
      'Би-2 Полковнику никто не пишет',
      'Сплин Мое сердце',
      'Земфира Искала',
      'Агата Кристи Как на войне',
      'ДДТ Что такое осень',
      'Ария Беспечный ангел',
      'Сектор Газа Туман',
      'Мумий Тролль Владивосток 2000',
      'Наутилус Помпилиус Скованные одной цепью',
      'Чайф Ой-йо',
      'Ленинград WWW',
      'Браво Этот город',
      'Чиж и Ко О любви',
      'Жуки Батарейка',
      'Ляпис Трубецкой Воины света',
      'Смысловые Галлюцинации Вечно молодой'
    ]
  },
  retro: {
    id: 'retro',
    title: 'Хиты 90-х и 2000-х',
    icon: '🪩',
    desc: 'Ностальгия, дискотеки и треки из магнитофонов и первых MP3-плееров',
    queries: [
      'Руки Вверх Крошка моя',
      'Иванушки Тополиный пух',
      'Дискотека Авария Новогодняя',
      'Demo Солнышко',
      'Отпетые Мошенники Люби меня люби',
      'Hi-Fi Седьмой лепесток',
      'ВИА Гра Попытка № 5',
      'Тату Нас не догонят',
      'Звери Районы кварталы',
      'Краски Он не знает ничего',
      'Вирус Ты меня не ищи',
      'Шура Твори добро',
      'МакSим Знаешь ли ты',
      'Блестящие А я все летала',
      'Гости из будущего Беги от меня',
      'Валерий Меладзе Салют Вера',
      'Фабрика Про любовь',
      'Сергей Жуков 18 мне уже'
    ]
  },
  world: {
    id: 'world',
    title: 'Мировые Поп-Хиты',
    icon: '🌍',
    desc: 'Платиновые синглы, взрывавшие стадионы и мировые радиостанции',
    queries: [
      'Queen Bohemian Rhapsody',
      'Michael Jackson Billie Jean',
      'The Weeknd Blinding Lights',
      'Dua Lipa Levitating',
      'Bruno Mars Uptown Funk',
      'Lady Gaga Bad Romance',
      'Rihanna Umbrella',
      'Coldplay Viva La Vida',
      'Daft Punk Get Lucky',
      'Adele Rolling in the Deep',
      'Eminem Lose Yourself',
      'ABBA Dancing Queen',
      'Bon Jovi Its My Life',
      'Ed Sheeran Shape of You',
      'Imagine Dragons Believer',
      'Nirvana Smells Like Teen Spirit',
      'Billie Eilish Bad Guy',
      'Avicii Wake Me Up'
    ]
  },
  charts: {
    id: 'charts',
    title: 'Современные Чарты',
    icon: '⚡',
    desc: 'Свежие бэнгеры, тренды TikTok и главные стриминговые хиты',
    queries: [
      'ANNA ASTI Царица',
      'MACAN ASPHALT 8',
      'Баста Сансара',
      'Miyagi Andy Panda Minor',
      'JONY Комета',
      'Клава Кока Покинула чат',
      'NILETTO Любимка',
      'Artik Asti Грустный дэнс',
      'HammAli Navai Прятки',
      'Моя Мишель Зима в сердце',
      'Xcho Ты и Я',
      'Mary Gu Не перебивай',
      'Инстасамка За деньги да',
      'Markul Стрелы',
      'Три дня дождя Отпускай',
      'Dabro Юность',
      'GAYAZOV$ BROTHER$ Малиновая лада',
      'Хабиб Ягода малинка'
    ]
  },
  ost: {
    id: 'ost',
    title: 'Кино & Саундтреки',
    icon: '🎬',
    desc: 'Узнаваемые с первых секунд мелодии из любимых фильмов и сериалов',
    queries: [
      'Hans Zimmer Interstellar',
      'Pirates of the Caribbean Theme Klaus Badelt',
      'Hedwig Theme John Williams Harry Potter',
      'Pulp Fiction Misirlou',
      'Survivor Eye of the Tiger',
      'Celine Dion My Heart Will Go On',
      'Ray Parker Jr Ghostbusters',
      'Star Wars The Imperial March John Williams',
      'Mission Impossible Theme Lalo Schifrin',
      'Сергей Шнуров Бумер Тема',
      'Игорь Корнелюк Бандитский Петербург Город которого нет',
      'Любэ Позови меня тихо по имени',
      'Би-2 Варвара',
      'The Pink Panther Theme Henry Mancini',
      'Ennio Morricone The Good the Bad and the Ugly',
      'Bill Conti Gonna Fly Now Rocky'
    ]
  }
};

async function fetchTrack(query) {
  try {
    const res = await fetch('https://itunes.apple.com/search?term=' + encodeURIComponent(query) + '&entity=song&limit=1');
    const data = await res.json();
    if (!data.results || data.results.length === 0) return null;
    const r = data.results[0];
    return {
      id: String(r.trackId),
      artist: r.artistName,
      title: r.trackName,
      displayTitle: `${r.artistName} — ${r.trackName}`,
      preview: r.previewUrl,
      art: (r.artworkUrl100 || '').replace('100x100bb', '400x400bb'),
      genre: r.primaryGenreName || 'Music'
    };
  } catch (e) {
    console.error('Failed fetch for', query, e.message);
    return null;
  }
}

async function build() {
  const result = {};
  for (const [key, pack] of Object.entries(PACK_DEFS)) {
    console.log(`Building pack: ${pack.title}...`);
    const tracks = [];
    for (const q of pack.queries) {
      const t = await fetchTrack(q);
      if (t && t.preview) {
        tracks.push(t);
        console.log(`  + ${t.displayTitle}`);
      } else {
        console.log(`  - NOT FOUND: ${q}`);
      }
      // slight delay to be nice
      await new Promise(r => setTimeout(r, 60));
    }
    result[key] = {
      id: pack.id,
      title: pack.title,
      icon: pack.icon,
      desc: pack.desc,
      tracks
    };
  }
  fs.writeFileSync('c:/Users/stasb/OneDrive/Desktop/ютуб/ясььььььььььььь/muzloto/packs.json', JSON.stringify(result, null, 2), 'utf-8');
  console.log('Saved packs.json successfully!');
}

build();
