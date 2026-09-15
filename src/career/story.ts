import type { RegionId } from './missions';

export const SERGEANT = 'Sgt. Bico-de-Aço';

/** Falas mostradas antes da PRIMEIRA missão de cada região. */
export const REGION_INTRO: Record<RegionId, readonly string[]> = {
  lago: [
    'Recruta! Bem-vindo à Divisão Olho de Águia.',
    'A Legião Grasnante quer dominar todos os lagos do mundo. Começando pelo do seu avô.',
    'Aqui ninguém usa gatilho. Você mira com os OLHOS e atira piscando. Não me pergunte como.',
  ],
  floresta: [
    'Notícia ruim, recruta: a Legião aprendeu a atacar de noite.',
    'Notícia boa: descobrimos que o seu olhar funciona como lanterna.',
    'Onde você não olha, você não vê. E eles sabem disso.',
  ],
};

export const BRIEFINGS: Record<string, readonly string[]> = {
  'lago-1': [
    'Treino básico. Olhe para um pato até o anel da mira ficar verde.',
    'Aí feche os dois olhos por um instante. Sem piscar à toa, hein?',
    'Acabou a munição? Feche só o olho esquerdo. O direito troca de arma. Sim, é sério.',
  ],
  'lago-2': [
    'Uma revoada inteira vindo. Mantenha a calma e a precisão.',
    'Quero ver você vencer sem o super. Super é para os fracos. Brincadeira. Mais ou menos.',
  ],
  'lago-3': [
    'Eles estão mais rápidos e menos pacientes.',
    'Nenhum deles pode escapar para contar aos outros onde você está.',
  ],
  'lago-4': [
    'A Legião mandou os blindados. Tiro normal só faz cócegas neles.',
    'Abra essa boca, carregue o super e mostre quem manda no lago.',
  ],
  'floresta-1': [
    'Primeira noite na floresta. Mova o olhar devagar e procure.',
    'Pato que você não ilumina, pato que você não acerta.',
  ],
  'floresta-2': [
    'As sombras estão rápidas hoje. Não deixe nenhuma escapar.',
  ],
  'floresta-3': [
    'Esses de olho arregalado são os Tímidos. Odeiam luz.',
    'Fique com a lanterna neles tempo demais e eles disparam para longe. Seja rápido.',
  ],
  'floresta-4': [
    'Emboscada, recruta! Blindados, Tímidos e mais pato do que eu consigo contar.',
    'Se sobreviver a esta noite, conto um segredo sobre a Legião.',
  ],
};

/** Mostrado no resultado ao completar a última missão da Floresta pela primeira vez. */
export const CAMPAIGN_HOOK: readonly string[] = [
  'Muito bem, recruta. Interceptamos uma mensagem da Legião...',
  'Eles têm uma BASE. E um general. Prepare-se.',
  '(continua em breve)',
];
