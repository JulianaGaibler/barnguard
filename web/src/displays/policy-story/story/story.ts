/**
 * The story the booth tells: Build your own age verification law.
 *
 * It opens as a policy booth and slips out of it at 1.05, when the progress row
 * goes and the narrative takes over. The ids are the script's. A remembered
 * choice is a flag written `key=value`, or a plain flag where nothing needs its
 * value. A reply stands alone as a short card, here `4.03a` and the like, where
 * the next screen opens with a new label. A screen that comes back with an
 * option gone, `5.01b` and `5.07b`, is a second copy of it.
 *
 * `mood` names a look from `ui/moods.ts` and holds until another screen names
 * one. `pace` and `hold` time how a screen's lines and its button arrive.
 */
import { defineStory } from './types'

/** The narrative voice: each line arrives after the one before. */
const beats = { pace: 'beats' } as const
/** The last chapter: the lines come slowly, and the buttons are small. */
const slow = { pace: 'slow', buttonStyle: 'small' } as const

export const story = defineStory({
  start: '1.01b',
  nodes: {
    // ---------------------------------------------------------------- chapter 1
    '1.01b': {
      kind: 'scene',
      mood: 'booth',
      body: [
        'You play an elected lawmaker. Parents in your district demand action on how their kids are exposed to social media.',
        'Your party expects a bill from your office by September, and your next election is in November.',
        'You make choices and see what they lead to. There is no right answer.',
      ],
      next: '1.02a',
    },
    '1.02a': {
      kind: 'scene',
      mood: 'booth',
      label: 'June. 5 months to the election.',
      body: [
        'Your staffer on technology policy, Dana, briefs you. Laws use many names for checking a user’s age, and they don’t mean the same thing.',
        'Age assurance is the umbrella term: any way for a service to learn a user’s age with some confidence. Three methods are common.',
      ],
      next: '1.02b',
    },
    '1.02b': {
      kind: 'scene',
      mood: 'booth',
      body: [
        'Age estimation: software guesses a user’s age from a selfie, a voice, or what the user watches and posts.',
        'Age verification: a user proves their age with an ID, a credit card or other documents.',
        'Age proof app: a user proves their age once to an app on their phone, and sites then ask the app.',
      ],
      next: '1.02c',
    },
    '1.02c': {
      kind: 'choice',
      body: ['Dana has a page on each method. You have time for one today.'],
      prompt: 'Choose which method you want to look at more closely.',
      options: [
        {
          id: 'estimation',
          label: 'Age estimation',
          reply: [
            'Dana says it is a guess, and it is least reliable for teenagers, the group these laws are about.',
          ],
          next: '1.03',
        },
        {
          id: 'verification',
          label: 'Age verification',
          reply: [
            'Dana says it shows who a user is, not only how old they are. Every site that collects the documents has to store them.',
          ],
          next: '1.03',
        },
        {
          id: 'app',
          label: 'Age proof app',
          reply: [
            'Dana says it can answer only “old enough” or “not old enough”. It needs an ID to set up, and a phone of your own.',
          ],
          next: '1.03',
        },
      ],
    },
    '1.03': {
      kind: 'choice',
      body: [
        'Dana arranges meetings with the groups that want a say in the bill. You have time for one of them this week.',
      ],
      prompt: 'Choose who you meet first.',
      options: [
        {
          id: 'social',
          label: 'A large social media company',
          reply: [
            'They say age checks belong in the app store, not in their apps. They offer to help write the bill.',
          ],
          next: '1.04',
        },
        {
          id: 'system',
          label: 'A phone operating system company',
          reply: [
            'They say age checks belong in the apps, not in the app store. They also offer to help write the bill.',
          ],
          next: '1.04',
        },
        {
          id: 'rights',
          label: 'A digital rights group',
          reply: [
            'They ask you not to pass an age check law at all. They leave you a long report.',
          ],
          next: '1.04',
        },
      ],
    },
    '1.04': {
      kind: 'choice',
      body: [
        '6:40 pm. Your phone buzzes. It’s your wife, Sam: “Just came home from work. Heating up yesterday’s lemon chicken, unless you want to forage?”',
      ],
      prompt: 'Choose how you respond to your wife.',
      options: [
        {
          id: 'home',
          label: 'Reply that you’ll be home by 7:30.',
          sets: ['dinner=home'],
          reply: ['Sam replies with a thumbs up.'],
          next: '1.05',
        },
        {
          id: 'burger-king',
          label: 'Suggest Burger King instead.',
          sets: ['dinner=burger-king'],
          reply: ['Sam replies with one word: “Nuggets.”'],
          next: '1.05',
        },
        {
          id: 'late',
          label: 'Say you’ll be late. She should eat.',
          sets: ['dinner=late'],
          reply: ['Sam replies “ok.” Lowercase.'],
          next: '1.05',
        },
      ],
    },
    '1.05': {
      kind: 'scene',
      ...beats,
      mood: 'driveway',
      dropsTrail: true,
      body: [
        [
          'You pull into the driveway',
          { when: { flag: 'dinner=home' }, text: 'at 7:55.' },
          {
            when: { flag: 'dinner=burger-king' },
            text: 'at 8:15, with a paper bag on the passenger seat.',
          },
          { when: { flag: 'dinner=late' }, text: 'at 9:40.' },
        ],
        'You sit in the car with the engine off. You pull out the claw clip that’s been pressing into your scalp since three, and rub the sore spot at the back of your head.',
        'You didn’t use to sit here like this.',
      ],
      next: '1.05b',
    },
    '1.05b': {
      kind: 'scene',
      ...beats,
      body: [
        'You used to come through the door already talking.',
        'Sam would be at the counter with a story from court.',
        'She can read a person in five minutes: who’s lying, who’s scared, who only wants someone to listen.',
      ],
      next: '1.05c',
    },
    '1.05c': {
      kind: 'scene',
      ...beats,
      body: [
        'She’d take apart opposing counsel in four questions.',
        'Then she’d come home and do his voice.',
        'You’d laugh until you had to sit down. She always watched for that laugh.',
      ],
      next: '1.05d',
    },
    '1.05d': {
      kind: 'scene',
      ...beats,
      body: [
        'Then it was your turn.',
        'You could tell a committee hearing about water permits so that Sam looked up from her book to hear who changed their vote.',
        'She said you made people lean in without noticing.',
      ],
      next: '1.05e',
    },
    '1.05e': {
      kind: 'scene',
      ...beats,
      hold: 0.5,
      body: [
        'You can’t remember the last time either of you told a story like that.',
      ],
      button: 'Go inside',
      next: '1.06',
    },
    '1.06': {
      kind: 'scene',
      ...beats,
      mood: 'home',
      body: [
        [
          'You hang your keys on the hook. Sam looks up. She’s still in her work blazer. “Hey, Steph,” she says. “Hey,” you say.',
          {
            when: { flag: 'dinner=home' },
            text: 'You kiss her hello. It’s quick. It used to be longer.',
          },
          {
            when: { flag: 'dinner=burger-king' },
            text: 'You put the paper bag on the table and she takes out the nuggets.',
          },
          {
            when: { flag: 'dinner=late' },
            text: 'She’s on the couch with her plate on her knees, barefoot but still in her work trousers. You kiss the top of her head on your way past.',
          },
        ],
      ],
      button: 'Sit down next to her',
      next: '1.06b',
    },
    '1.06b': {
      kind: 'choice',
      ...beats,
      body: [
        'Next to her is one of her stacks of case files, tall enough to fall over. On top is a book with sticky notes in four colors coming out of it. She sees you looking.',
        '“Have you read this?” Sam asks. “You have to read this!”',
        'It’s The Anxious Generation.',
      ],
      options: [
        {
          id: 'listened',
          label: '“Tell me about it.”',
          sets: ['book=listened'],
          next: '1.07',
        },
        {
          id: 'promised',
          label: '“I’ll read it this weekend.”',
          sets: ['book=promised'],
          next: '1.07',
        },
        {
          id: 'joked',
          label: '“Is that the one everyone quotes at me?”',
          sets: ['book=joked'],
          next: '1.07',
        },
      ],
    },
    '1.07': {
      kind: 'scene',
      ...beats,
      body: [
        {
          when: { flag: 'book=listened' },
          text: 'She talks for forty minutes. Kids went from a play-based childhood to a phone-based one, she says.',
        },
        {
          when: { flag: 'book=listened' },
          text: 'She acts out a twelve-year-old explaining an app. “It’s like TikTok but for people who hate TikTok. Keep up, Mom.”',
        },
        {
          when: { flag: 'book=listened' },
          text: 'It’s the first impression you’ve seen in months.',
        },
        {
          when: { all: [{ flag: 'book=listened' }, { flag: 'dinner=late' }] },
          text: 'You never get up to find something to eat.',
        },
        {
          when: {
            all: [{ flag: 'book=listened' }, { not: { flag: 'dinner=late' } }],
          },
          text: 'The food in front of you gets cold.',
        },
        {
          when: { flag: 'book=promised' },
          text: '“This weekend,” she says. “I’m holding you to that.”',
        },
        {
          when: { flag: 'book=joked' },
          text: '“Probably,” she says. “They quote it because it’s right.”',
        },
        {
          when: { flag: 'book=joked' },
          text: 'She reads you a page anyway. You let her.',
        },
      ],
      button: 'Clear the plates',
      next: '1.08',
    },
    '1.08': {
      kind: 'choice',
      ...beats,
      body: [
        'Sam counts on her fingers. “No smartphones before high school. No social media before sixteen. No phones in school.”',
        '“And kids get to go outside again. On their own.”',
        '“We wrap them in bubble wrap outside and then hand them the whole internet,” she says. “We played outside until the streetlights came on.”',
      ],
      options: [
        {
          id: 'bill',
          label: '“So you want that in the bill.”',
          reply: [
            '“Yes,” she says. “You have to take a position anyway. Take this one.”',
          ],
          next: '1.09',
        },
        {
          id: 'internet',
          label: '“You played outside because there was no internet.”',
          reply: [
            '“Exactly,” she says. “And we were fine. You’re writing the bill. You could give kids that back.”',
          ],
          next: '1.09',
        },
        {
          id: 'kid',
          label: '“What would our kid do?”',
          reply: [
            'She looks at you a second longer than usual. “Ours would go outside,” she says. “Ours would come back muddy. Write a law where that’s normal again.”',
          ],
          next: '1.09',
        },
      ],
    },
    '1.09': {
      kind: 'scene',
      ...beats,
      body: [
        'Sam always wanted kids. So did you.',
        'You were the one who bought the tiny rain boots at a flea market, years ago. They are still in the closet.',
        'But you wanted it the way you want things that are far away.',
        'For a long time you didn’t notice how much closer it was for her.',
      ],
      next: '1.09b',
    },
    '1.09b': {
      kind: 'scene',
      ...beats,
      body: [
        'The winter before your first campaign, you sat on the floor of the empty office you’d just rented.',
        'You said: after the election.',
        'Sam said fine, and she meant it. She painted the office walls that weekend.',
      ],
      next: '1.09c',
    },
    '1.09c': {
      kind: 'scene',
      ...beats,
      body: [
        'Then you won, and there was a new job to learn.',
        'You blinked, and suddenly there was the next election.',
        'Sometimes you catch her watching a stroller go by. She looks away when she sees you notice.',
        'You feel it in your stomach every time.',
      ],
      next: '1.09d',
    },
    '1.09d': {
      kind: 'scene',
      ...beats,
      body: [
        'Back then it was always going to be Sam. She wanted to carry. You were happy to let her.',
        'She even made a timeline. It’s in a folder somewhere. By now probably at the bottom of a large stack of files.',
        'She’s 39 now. Her doctor basicially said the word “risk” at every checkup now.',
        'You’re 36. Nobody has said it out loud, but the question has started to move across the table to you.',
      ],
      next: '1.09e',
    },
    '1.09e': {
      kind: 'scene',
      ...beats,
      hold: 0.5,
      body: [
        'You want it too. Some nights you lie awake and picture it: a tiny little creature in your arm, Sam reading out loud.',
        'Then you look at your calendar. Committee in the morning, a town hall at night, an election every two years.',
        'When would you even do it?',
        'You bite the inside of your cheek. You still don’t say anything.',
      ],
      button: 'Wash the dishes',
      next: '1.10',
    },
    '1.10': {
      kind: 'scene',
      ...beats,
      body: [
        {
          when: { flag: 'book=promised' },
          text: 'The book is on your nightstand. A sticky note on the cover says “You promised.”',
        },
        'You leave the bedroom door open when you go to brush your teeth. When you come back, it’s closed.',
        'Sam is in bed in your old campaign T-shirt.',
        'You stopped asking for it back years ago.',
      ],
      next: '1.10b',
    },
    '1.10b': {
      kind: 'scene',
      ...beats,
      body: [
        'She likes doors closed. After a day of clients, a closed door is how she gets herself back. You like them open.',
        'You’ve done this for ten years. Neither of you has ever said a word about it.',
      ],
      button: 'Go to bed',
      next: '1.11',
    },
    '1.11': {
      kind: 'choice',
      ...beats,
      mood: 'office',
      body: ['On Monday Dana asks about your weekend.'],
      options: [
        {
          id: 'reading',
          label: '“Sam’s reading something called The Anxious Generation.”',
          reply: [
            'You tell her about the sticky notes in four colors.',
            'Dana frowns. It’s a small frown. You’ve seen it in committee, right before she ruins someone’s afternoon.',
          ],
          next: '1.11b',
        },
        {
          id: 'long',
          label: '“Long.”',
          reply: [
            'Then you tell her why. Sam is reading something called The Anxious Generation, and she has questions about your bill.',
            'Dana frowns. It’s a small frown. You’ve seen it in committee, right before she ruins someone’s afternoon.',
          ],
          next: '1.11b',
        },
        {
          id: 'homework',
          label: '“I have homework now.”',
          reply: [
            '“Sam wants me to read something called The Anxious Generation,” you say. “She’s put sticky notes in it.”',
            'Dana frowns. It’s a small frown. You’ve seen it in committee, right before she ruins someone’s afternoon.',
          ],
          next: '1.11b',
        },
      ],
    },
    '1.11b': {
      kind: 'choice',
      ...beats,
      body: [
        '“Okay,” she says. She hesitates. “Can I tell you what I think of it?”',
      ],
      options: [
        { id: 'go-ahead', label: '“Go ahead.”', next: '1.12' },
        { id: 'that-bad', label: '“Is it that bad?”', next: '1.12' },
        { id: 'short', label: '“Short version, please.”', next: '1.12' },
      ],
    },
    '1.12': {
      kind: 'scene',
      ...beats,
      body: [
        'Dana draws two lines on the whiteboard. Both go up after 2012.',
        'One is teen depression. One is smartphones.',
        '“Haidt says the second one caused the first,” she says.',
      ],
      next: '1.12b',
    },
    '1.12b': {
      kind: 'choice',
      ...beats,
      body: [
        'Before politics, you spent six years analyzing data for a solar company. Before that, a graduate degree in psychology with plenty of statistics electives.',
        'Dana knows this. Last month she told a lobbyist, “She has a degree in this. Bring better charts.”',
        '“So,” Dana says. “What do you call two lines that go up at the same time?”',
      ],
      options: [
        {
          id: 'correlation',
          label: '“A correlation.”',
          reply: ['“Thank you,” she says.'],
          next: '1.13',
        },
        {
          id: 'marketing',
          label: '“A coincidence with good marketing.”',
          reply: [
            'Dana laughs. “I’m stealing that,” she says. Then she writes “correlation” on the board anyway.',
          ],
          next: '1.13',
        },
        {
          id: 'know',
          label: '“I know what a correlation is, Dana.”',
          reply: [
            '“I know you know,” she says. “Sorry. I explain this to a lot of people.”',
          ],
          next: '1.13',
        },
      ],
    },
    '1.13': {
      kind: 'scene',
      ...beats,
      body: [
        'She pulls up a few reviews of the book by researchers who study teenagers. They say what she just said, with more footnotes.',
        '“And it leaves out everything else that was going on in those kids’ lives,” Dana says.',
        'She counts on her fingers, the way Sam did. She runs out of fingers.',
      ],
      button: 'Read the reviews',
      next: '1.14',
    },
    '1.14': {
      kind: 'choice',
      ...beats,
      body: [
        '“This is the part that bothers me,” Dana says. “A ban hits hardest the kids the internet helps most.”',
        'Gay kids in small towns. Kids whose homes aren’t safe. Kids whose only friends are online.',
      ],
      options: [
        {
          id: 'would-you',
          label: '“So what would you do?”',
          reply: [
            '“Make the companies change the product,” she says. “Don’t make kids show ID.”',
          ],
          next: '1.15',
        },
        {
          id: 'parents',
          label: '“Parents believe it, though.”',
          reply: [
            '“They believe it because it’s what they see,” Dana says. “That doesn’t make it the cause.”',
          ],
          next: '1.15',
        },
        {
          id: 'tell-sam',
          label: '“How do I tell Sam that?”',
          reply: [
            'Dana winces. “Carefully,” she says. “Sounds like she really took a liking to this book.”',
          ],
          next: '1.15',
        },
      ],
    },
    '1.15': {
      kind: 'scene',
      ...beats,
      body: [
        'You write “correlation” on a sticky note and put it on your laptop.',
        'The first year you lived together, Sam left sticky notes all over the apartment.',
        'On the mirror: “You look like a senator.” Inside your shoe: “Wrong foot.”',
      ],
      next: '1.15b',
    },
    '1.15b': {
      kind: 'scene',
      ...beats,
      body: [
        'You hid yours in her case files. She never mentioned them.',
        'Years later you found out she had kept every one.',
        'Somewhere along the way, you both stopped.',
      ],
      next: '1.15c',
    },
    '1.15c': {
      kind: 'scene',
      ...beats,
      body: [
        'You ran for office to keep the reservoirs from running dry, and to get solar projects approved in months instead of years.',
        'You did not run to decide how old someone has to be to use an app.',
        'But the party leadership tends to hand the “children and family” issues to the women in the caucus. And nobody calls about the reservoirs.',
      ],
      next: '1.15d',
    },
    '1.15d': {
      kind: 'scene',
      ...beats,
      mood: 'home',
      body: [
        'That night Sam asks how work was. “Fine,” you say.',
        {
          when: { flag: 'book=promised' },
          text: 'The book is still on your nightstand. You put your phone on top of it.',
        },
      ],
      button: 'Turn off the light',
      next: '2.01',
    },

    // ---------------------------------------------------------------- chapter 2
    '2.01': {
      kind: 'choice',
      ...beats,
      mood: 'sunday',
      label: 'July. 4 months to the election.',
      body: [
        'Sundays still feel like they used to.',
        'You bike to the grocery store together. Sam has the list you wrote earlier.',
        'You’re in charge of snacks.',
      ],
      options: [
        {
          id: 'chips',
          label: 'Grab chips.',
          sets: ['snack=chips'],
          reply: ['Sam adds salsa to the basket. She doesn’t say anything.'],
          next: '2.02',
        },
        {
          id: 'gummy-bears',
          label: 'Grab gummy bears.',
          sets: ['snack=gummy-bears'],
          reply: [
            '“You’re thirty-six,” Sam says with a grin. She puts them in the basket.',
          ],
          next: '2.02',
        },
        {
          id: 'cookies',
          label: 'Grab the cookies Sam says she doesn’t like.',
          sets: ['snack=cookies'],
          reply: [
            '“I don’t like those,” Sam says. She eats one before you get home.',
          ],
          next: '2.02',
        },
      ],
    },
    '2.02': {
      kind: 'scene',
      ...beats,
      body: [
        'In the cereal aisle, a man paces next to his cart, on a work call.',
        'His toddler sits in the cart with a banana pressed to his ear. Every time his dad nods, he nods too.',
        'Sam catches the kid’s eye. She nods at him, slow and serious, like she’s agreeing to terms.',
        'He nods back. She nods again. Two very serious people, closing a deal over a banana.',
      ],
      next: '2.02b',
    },
    '2.02b': {
      kind: 'choice',
      ...beats,
      body: [
        'You lose it. You laugh so hard you have to hold on to the cart, the laugh you used to fill rooms with at parties.',
        'The dad turns around, annoyed. Sam keeps a straight face the whole time.',
        'But she looks pleased with herself. You haven’t seen that look in a while.',
      ],
      options: [
        {
          id: 'cereal-aisle',
          label: '“Don’t make me laugh in the cereal aisle.”',
          reply: ['“Too late,” Sam says.'],
          next: '2.03',
        },
        {
          id: 'phone-based',
          label: '“See? A phone-based childhood.”',
          reply: ['“Don’t,” she says. She’s still smiling.'],
          next: '2.03',
        },
        {
          id: 'posture',
          label: '“He has better posture than his dad.”',
          reply: ['Sam snorts. “He’ll go far.”'],
          next: '2.03',
        },
      ],
    },
    '2.03': {
      kind: 'choice',
      ...beats,
      body: [
        'Outside, while you unlock the bikes, Sam says, “If we had one... a child, that is. What would we call her?”',
        'She says it lightly. She’s looking at the lock, not at you.',
      ],
      options: [
        {
          id: 'isabelle',
          label: '“Isabelle. After your grandmother.”',
          sets: ['name=Isabelle'],
          reply: [
            'Sam is quiet for a second. “She’d like that,” she says.',
            'Her grandmother died in 2019. Sam spoke at the service and brought the whole gathering to laughter twice.',
          ],
          next: '2.04',
        },
        {
          id: 'june',
          label: '“June. We met in June. And it sounds nice.”',
          sets: ['name=June'],
          reply: [
            '“You remember that?” she says. “I remember the cereal box,” you say with a sheepish smile.',
          ],
          next: '2.04',
        },
        {
          id: 'ada',
          label: '“Ada. Short. Hard to mess up.”',
          sets: ['name=Ada'],
          reply: ['“Ada,” she says. She tries it a few times. “Ada. Okay.”'],
          next: '2.04',
        },
        {
          id: 'later',
          label: '“Can we do this later?”',
          sets: ['name=Isabelle'],
          reply: [
            '“Sure,” she says. She gets on her bike. Then, without looking back: “I like Isabelle.”',
          ],
          next: '2.04',
        },
      ],
    },
    '2.04': {
      kind: 'choice',
      ...beats,
      body: [
        'She rides ahead of you the whole way.',
        'At the next red light she says, without turning around, “We said after the election. Last time too.”',
      ],
      options: [
        {
          id: 'meant-it',
          label: '“And we meant it.”',
          reply: ['“You meant it,” she says. The light turns green.'],
          next: '2.05',
        },
        {
          id: 'i-know',
          label: '“I know.”',
          reply: ['The light turns green.'],
          next: '2.05',
        },
        {
          id: 'nothing',
          label: 'Say nothing',
          reply: ['The light turns green.'],
          next: '2.05',
        },
      ],
    },
    '2.05': {
      kind: 'scene',
      ...beats,
      body: [
        'Two years ago, Sam ran your first campaign from the kitchen table.',
        'She had a spreadsheet of every door in the district, color-coded by how likely they were to open.',
        'She went through your opponent’s voting record like a hostile witness.',
        'She made you practice the drought speech until you could say it without notes.',
      ],
      next: '2.05b',
    },
    '2.05b': {
      kind: 'scene',
      ...beats,
      body: [
        'On election night she fell asleep on the couch in her blazer.',
        'You put a blanket over her and didn’t sleep at all.',
      ],
      next: '2.05c',
    },
    '2.05c': {
      kind: 'scene',
      ...beats,
      hold: 0.5,
      body: [
        'This time you have a staff of nine. Sam helps on some weekends.',
        'She hasn’t asked to see the spreadsheet.',
      ],
      button: 'Put the groceries away',
      next: '2.06',
    },
    '2.06': {
      kind: 'choice',
      ...beats,
      mood: 'home',
      body: [
        'Sam brings the book to dinner most nights now. Tonight she reads you a part about letting kids walk to the park on their own.',
        'Then she asks what you’re putting in the bill.',
      ],
      options: [
        {
          id: 'doubts',
          label: '“Dana has some doubts about the book.”',
          reply: ['“What kind of doubts?” Sam asks.'],
          next: '2.07',
        },
        {
          id: 'early',
          label: '“It’s still early.”',
          reply: [
            '“You said that last week,” Sam says. “What does Dana think?”',
          ],
          next: '2.07',
        },
        {
          id: 'not-at-dinner',
          label: '“Can we not do work at dinner?”',
          reply: [
            '“We never do work at dinner anymore,” Sam says. “What does Dana think?”',
          ],
          next: '2.07',
        },
      ],
    },
    '2.07': {
      kind: 'choice',
      ...beats,
      agitation: 0.3,
      mood: 'fight',
      body: [
        'You tell her. The two lines on the whiteboard. The kids whose only friends are online.',
        'Sam puts her fork down. You know this voice. Witnesses don’t like this voice.',
        '“Dana,” she says.',
      ],
      options: [
        {
          id: 'eleven-years',
          label: '“She’s done this for eleven years.”',
          reply: ['“And I’ve done this with you for ten,” Sam says.'],
          next: '2.08',
        },
        {
          id: 'thin-data',
          label: '“She has a point. The data is thin.”',
          reply: ['“You always have a point,” Sam says.'],
          next: '2.08',
        },
        {
          id: 'just-telling',
          label: '“I’m just telling you what she said.”',
          reply: ['“No,” Sam says. “You’re telling me you agree with her.”'],
          next: '2.08',
        },
      ],
    },
    '2.08': {
      kind: 'choice',
      ...beats,
      agitation: 0.7,
      body: [
        '“I was there before Dana,” Sam says. “Before any of them.”',
        '“And now someone you hired gets to tell you what I think is stupid.”',
      ],
      options: [
        {
          id: 'stupid',
          label: '“Nobody said you’re stupid.”',
          reply: ['“Nobody had to,” she says.'],
          next: '2.09',
        },
        {
          id: 'campaign',
          label: '“This isn’t about the campaign.”',
          reply: [
            '“Everything is about the campaign,” she says. “That’s the problem.”',
          ],
          next: '2.09',
        },
        {
          id: 'read-it',
          label: '“I should have read it myself.”',
          reply: [
            {
              when: { flag: 'book=promised' },
              text: '“It’s on your nightstand,” she says. “Under your phone.”',
            },
            {
              when: { flag: 'book=listened' },
              text: '“You listened when I told you about it,” she says. “What happened?”',
            },
            {
              when: { flag: 'book=joked' },
              text: '“You made a joke about it,” she says. “I remember.”',
            },
          ],
          next: '2.09',
        },
      ],
    },
    '2.09': {
      kind: 'choice',
      ...beats,
      agitation: 1,
      body: [
        '“It’s not about the book,” Sam says.',
        '“It’s about what you promised me back then. It’s about {name}.”',
        'Her voice drops. It’s quiet, and very steady.',
        '“I’m trying to get the world ready for a child you won’t put in your calendar.”',
        'Your breath catches.',
      ],
      options: [
        {
          id: 'unfair',
          label: '“That’s not fair.”',
          reply: ['“No,” she says. “It isn’t.”'],
          next: '2.10',
        },
        {
          id: 'her-name',
          label: '“Sam.”',
          reply: ['She waits for the rest of the sentence. There isn’t any.'],
          next: '2.10',
        },
        {
          id: 'silence',
          label: 'Say nothing.',
          reply: ['She waits.'],
          next: '2.10',
        },
      ],
    },
    '2.10': {
      kind: 'choice',
      ...beats,
      agitation: 0.5,
      hold: 0.4,
      body: [
        'She takes her plate to the kitchen. Closing the door behind her.',
      ],
      options: [
        { id: 'clear', label: 'Clear your plate', next: '3.01' },
        { id: 'stay', label: 'Stay at the table', next: '3.01' },
      ],
    },

    // ---------------------------------------------------------------- chapter 3
    '3.01': {
      kind: 'scene',
      ...beats,
      mood: 'drab',
      label: 'August. 3 months to the election.',
      body: [
        'Sunday nights are for the shows.',
        'Sam picks them, adaptations more often than not. She has always read the book first.',
        'Halfway through an episode she leans over and whispers what they cut, what they changed, which character was better in the original.',
      ],
      next: '3.01b',
    },
    '3.01b': {
      kind: 'scene',
      ...beats,
      body: [
        'You never had the energy for the books. You didn’t need to.',
        'Watching her get that excited about a side character’s backstory was half the reason you watched.',
      ],
      next: '3.01c',
    },
    '3.01c': {
      kind: 'choice',
      ...beats,
      hold: 0.4,
      body: [
        'Tonight is the last episode of the season.',
        'She doesn’t lean over once.',
      ],
      options: [
        {
          id: 'original-ending',
          label: '“Did they keep the original ending?”',
          reply: ['“No,” she says. That’s all.'],
          next: '3.02',
        },
        {
          id: 'feet',
          label: 'Put your feet on her side',
          reply: [
            'She doesn’t move them. She doesn’t touch them either.',
            'She used to trace the little cat tattoo on your ankle during the slow parts.',
            'Your ankle is cold. You can almost feel her thumb there anyway.',
          ],
          next: '3.02',
        },
        {
          id: 'keep-watching',
          label: 'Keep watching',
          reply: [
            'The episode ends. The next one starts on its own. Neither of you stops it.',
          ],
          next: '3.02',
        },
      ],
    },
    '3.02': {
      kind: 'scene',
      ...beats,
      hold: 0.7,
      body: [
        'She sits at one end of the couch. You sit at the other.',
        'The middle cushion used to have a dent in it, from where you fell asleep with your head in her lap.',
      ],
      button: 'Say goodnight',
      next: '3.03',
    },
    '3.03': {
      kind: 'scene',
      ...beats,
      body: [
        'You stop talking about work at home. Some time later, Sam stops talking about hers too.',
        'You used to know her clients. The man who sued his neighbor over a tree. The woman with three dogs and four versions of her will.',
        'Now you only know the names of the people on the show.',
      ],
      button: 'Go to work',
      next: '3.04',
    },
    '3.04': {
      kind: 'choice',
      ...beats,
      mood: 'office',
      body: ['Tuesday, 6:40 pm. Dana is packing up. You could go home.'],
      options: [
        {
          id: 'go-home',
          label: 'Go home',
          reply: [
            {
              when: { flag: 'dinner=late' },
              text: 'The lemon chicken is in the fridge, with a portion gone. Sam is reading in the bedroom with the door closed.',
            },
            {
              when: { not: { flag: 'dinner=late' } },
              text: 'Sam is eating on the couch. “There’s some left,” she says. There is.',
            },
          ],
          next: '3.05',
        },
        {
          id: 'stay',
          label: 'Stay and work on the bill',
          reply: ['You open the bill. You don’t type anything.'],
          next: '3.05',
        },
        {
          id: 'lock-up',
          label: 'Tell Dana you’ll lock up',
          reply: [
            'Dana looks at you. “Okay,” she says. She leaves the light on.',
          ],
          next: '3.05',
        },
      ],
    },
    '3.05': {
      kind: 'scene',
      ...beats,
      body: [
        'By the third week, you stop asking yourself whether to go home.',
        'The couch in your office is too short. You lie on it with your knees up.',
        'Your bra has been digging into your ribs since the noon meeting. You shift on the cushion. It doesn’t help.',
      ],
      next: '3.05b',
    },
    '3.05b': {
      kind: 'scene',
      ...beats,
      body: [
        'You scroll your phone.',
        'The pictures go by. You just move your thumb.',
        'Twice you open your messages with Sam. Twice you close them again.',
      ],
      button: 'Keep scrolling',
      next: '3.06',
    },
    '3.06': {
      kind: 'choice',
      ...beats,
      body: [
        'Greg cleans your floor at nine in his faded blue coveralls.',
        'On the fourth night he asks if you want the light left on.',
      ],
      options: [
        {
          id: 'on',
          label: '“Leave it on.”',
          reply: ['He leaves it on.'],
          next: '3.07',
        },
        {
          id: 'off',
          label: '“You can turn it off.”',
          reply: ['He turns it off. Your phone lights up your face.'],
          next: '3.07',
        },
        {
          id: 'sit',
          label: 'Offer him the chair',
          reply: [
            'He waves the chair away and sits on the edge of your desk.',
            '“My wife says I work too much,” he says. “I clean offices at night. Imagine what she’d say about you.”',
          ],
          next: '3.07',
        },
      ],
    },
    '3.07': {
      kind: 'scene',
      ...beats,
      hold: 0.8,
      body: [
        'You text Sam that the bill is taking more time than you expected. It isn’t.',
        'As if it had been waiting for this, your phone shows you a photo from ten years ago.',
        'Sam, in someone else’s kitchen, holding a cereal box.',
        'She is not smiling. She is trying very hard not to.',
      ],
      button: 'Open the photo',
      next: '4.01',
    },

    // ---------------------------------------------------------------- chapter 4
    '4.01': {
      kind: 'scene',
      ...beats,
      mood: 'party',
      label: '2016. You are 26.',
      body: [
        'You meet Sam at Priya’s party. Everyone is out on the balcony.',
        'She is in the kitchen, alone, frowning at the back of a box of corn flakes like it owes her money.',
      ],
      next: '4.01b',
    },
    '4.01b': {
      kind: 'choice',
      ...beats,
      body: [
        'She’s in a gray-blue blouse with the sleeves pushed up. A strand of brown hair keeps falling into her face. She keeps tucking it back without looking up.',
        'You’re in the orange sweater Priya says makes you look like a traffic cone. You smile at her anyway.',
      ],
      options: [
        {
          id: 'good-box',
          label: '“Is it a good box?”',
          reply: [
            '“There’s a maze,” she says. “You’d think it would be easier.”',
          ],
          next: '4.02',
        },
        {
          id: 'hiding',
          label: '“I’m hiding too.”',
          reply: ['“I’m not hiding,” she says. “There’s a maze on the back.”'],
          next: '4.02',
        },
        {
          id: 'drink',
          label: '“Can I get you a drink?”',
          reply: ['She holds up a glass of tap water. “I’m set. Thank you.”'],
          next: '4.02',
        },
      ],
    },
    '4.02': {
      kind: 'scene',
      ...beats,
      body: [
        'You stay in the kitchen for two hours.',
        'Every time one of you refills a glass, you end up standing a little closer.',
        'She tells you she quit her law firm in April and hasn’t left her apartment much since. Priya made her come.',
        'She says it to the cereal box, not to you.',
      ],
      next: '4.02b',
    },
    '4.02b': {
      kind: 'scene',
      ...beats,
      body: [
        'Her eyes are green, with a darker ring around the edge. You keep finding reasons to look at them.',
        'She catches you. The corner of her mouth moves. She doesn’t look away either.',
        'You make her laugh twice. The second time, water comes out of her nose.',
      ],
      button: 'Get her a napkin',
      next: '4.03',
    },
    '4.03': {
      kind: 'choice',
      ...beats,
      hold: 0.4,
      body: [
        'When you come back with the napkin, she’s gone.',
        'So is the cereal box.',
      ],
      options: [
        { id: 'priya', label: 'Ask Priya for her number', next: '4.03a' },
        {
          id: 'stairs',
          label: 'Run down the stairs after her',
          next: '4.03b',
        },
      ],
    },
    '4.03a': {
      kind: 'moment',
      ...beats,
      body: [
        '“She’ll say no,” Priya says.',
        'You wait four days to call. You think about her eyes for all four.',
        'She says yes.',
      ],
      button: 'Call her',
      next: '4.04',
    },
    '4.03b': {
      kind: 'moment',
      ...beats,
      body: [
        'You catch her at the front door, out of breath.',
        'She writes her number on the cereal box. Did she bring that with her?',
        'Her fingers brush yours when she hands it over. Neither of you mentions it.',
      ],
      button: 'Call her',
      next: '4.04',
    },
    '4.04': {
      kind: 'choice',
      ...beats,
      mood: 'memory',
      label: '2017. You are 27.',
      body: [
        'Sam has an interview tomorrow at a small firm downtown. It’s the third date they’ve set. She cancelled the first two.',
        'She’s on your sofa with the lights off.',
        '“I can’t do it again,” she says. She doesn’t say what “it” is. You know.',
      ],
      options: [
        {
          id: 'dont-go',
          label: '“Then don’t go.”',
          reply: [
            'She laughs, and the laugh turns into crying. “That’s terrible advice,” she says.',
          ],
          next: '4.05',
        },
        { id: 'sit-down', label: 'Sit down next to her', next: '4.05' },
        {
          id: 'drive-you',
          label: '“You can. I’ll drive you.”',
          reply: ['She shakes her head. She’s crying now.'],
          next: '4.05',
        },
      ],
    },
    '4.05': {
      kind: 'scene',
      ...beats,
      hold: 0.6,
      body: [
        'You sit down next to her. You don’t say anything.',
        'You let your knee rest against hers.',
        'After a while she leans into your shoulder.',
        'You find her hand in the dark. You run your thumb over her knuckles, slowly, back and forth.',
        'Her breathing slows down to match yours.',
      ],
      button: 'Hold her',
      next: '4.06',
    },
    '4.06': {
      kind: 'scene',
      ...beats,
      body: [
        'In the morning you drive her downtown. You wait in the car for 51 minutes.',
        'She comes out running.',
        'She kisses you through the open car window, in front of the whole building.',
        'She got the job. Nine years later, she still works there.',
      ],
      button: 'Kiss her back',
      next: '4.07',
    },
    '4.07': {
      kind: 'scene',
      ...beats,
      label: '2021. You are 31.',
      body: [
        'Sam likes gold. You like silver. For three weeks it’s the only thing you fight about.',
        'The jeweler finds the compromise. A ring that is silver outside and gold inside, and one that is the other way around.',
        'You wear your color on the outside. Hers is on the inside, against your skin.',
      ],
      button: 'Kiss your bride',
      next: '4.08',
    },
    '4.08': {
      kind: 'choice',
      ...beats,
      mood: 'cold',
      label: 'August. Present.',
      hold: 0.4,
      body: [
        'The office is dark. Greg has turned off the hall lights.',
        'You turn the ring on your finger until you can see a thin edge of gold.',
      ],
      options: [
        { id: 'go-home', label: 'Go home', next: '4.08a' },
        { id: 'stay', label: 'Stay here tonight', next: '4.08b' },
      ],
    },
    '4.08a': {
      kind: 'moment',
      ...beats,
      body: [
        'Sam is asleep. The bedroom door is closed.',
        'You open it as quietly as you can.',
      ],
      button: 'Close your eyes',
      next: '5.01',
    },
    '4.08b': {
      kind: 'moment',
      ...beats,
      body: [
        'The building turns the air conditioning down at night. The office gets cold.',
        'You pull the spare cardigan off the back of your chair and sleep under it with your shoes on.',
        'At 1 am you text Sam: “Fell asleep at work.” She doesn’t reply.',
        'She’s asleep, you tell yourself.',
      ],
      button: 'Close your eyes',
      next: '5.01',
    },

    // ---------------------------------------------------------------- chapter 5
    '5.01': {
      kind: 'choice',
      mood: 'bill',
      label: 'September. 2 months to the election.',
      body: ['Your bill is due Friday. Dana puts three options on the table.'],
      prompt: 'Choose what your bill does.',
      options: [
        {
          id: 'id',
          label: 'Require a government ID for every social media account.',
          next: '5.02',
        },
        {
          id: 'app',
          label:
            'Require an age proof app that tells sites only whether a user is old enough.',
          sets: ['bill=age-proof-app'],
          reply: [
            'Dana does a small, almost imperceptible nod. “The biggest platforms will like it,” she says. “Wallis will call it soft.”',
            {
              when: { flag: 'tried-id' },
              text: '“I saw you type the other one,” she says. “But you got there in the end.”',
            },
          ],
          next: '5.03',
        },
        {
          id: 'design',
          label:
            'Require platforms to change their design for users under 16. No ID checks.',
          sets: ['bill=design-rules'],
          reply: [
            'Dana smiles for the first time this month. “Wallis will call it soft,” she says. “But it’s the one I would have written.”',
            {
              when: { flag: 'tried-id' },
              text: '“I saw you type the other one,” she says. “But you got there in the end.”',
            },
          ],
          next: '5.03',
        },
      ],
    },
    '5.02': {
      kind: 'scene',
      ...beats,
      hold: 0.6,
      body: [
        'You type it into the draft. You read it back.',
        'You think about the people Dana told you about who have no ID.',
        'You delete it.',
      ],
      button: 'Choose again',
      sets: ['tried-id'],
      next: '5.01b',
    },
    '5.01b': {
      kind: 'choice',
      body: ['Your bill is due Friday. Dana puts three options on the table.'],
      prompt: 'Choose what your bill does.',
      options: [
        {
          id: 'app',
          label:
            'Require an age proof app that tells sites only whether a user is old enough.',
          sets: ['bill=age-proof-app'],
          reply: [
            'Dana nods. “The biggest platforms will like it,” she says. “Wallis will call it soft.”',
            {
              when: { flag: 'tried-id' },
              text: '“I saw you type the other one,” she says. “But you got there in the end.”',
            },
          ],
          next: '5.03',
        },
        {
          id: 'design',
          label:
            'Require platforms to change their design for users under 16. No ID checks.',
          sets: ['bill=design-rules'],
          reply: [
            'Dana smiles for the first time this month. “Wallis will call it soft,” she says. “It’s the one I would have written.”',
            {
              when: { flag: 'tried-id' },
              text: '“I saw you type the other one,” she says. “But you got there in the end.”',
            },
          ],
          next: '5.03',
        },
      ],
    },
    '5.03': {
      kind: 'choice',
      ...beats,
      mood: 'office',
      body: [
        'A security researcher and a digital rights lawyer ask to read the draft before Friday.',
      ],
      options: [
        {
          id: 'met',
          label: 'Meet them Thursday night.',
          reply: [
            'They find a gap in how long data can be kept. You fix it before you leave.',
          ],
          next: '5.04',
        },
        {
          id: 'skipped',
          label: 'Send the bill as it is.',
          sets: ['review-skipped'],
          reply: [
            'You send it at six on Friday. Nobody reads it closely until later.',
          ],
          next: '5.04',
        },
      ],
    },
    '5.04': {
      kind: 'scene',
      ...beats,
      hold: 0.6,
      body: [
        'Your opponent, David Wallis, is two points ahead.',
        'His new ad shows a girl in a dark bedroom, her face lit by a phone.',
        '“David Wallis will protect our kids,” the voice says. “Stephanie Thompson won’t.”',
      ],
      button: 'Turn it off',
      next: '5.05',
    },
    '5.05': {
      kind: 'choice',
      ...beats,
      mood: 'drab',
      body: [
        'You come home at eleven. Sam is asleep.',
        'The book is on the kitchen table with a sticky note on it: “p. 214.”',
        'These days, that’s the only kind of note she leaves you.',
      ],
      options: [
        {
          id: 'read',
          label: 'Read page 214',
          reply: [
            'It’s about parents making a pact. If every family on the street waits, no kid is the only one without a phone.',
            'In the margin Sam has written: “So nobody has to be the bad guy.”',
          ],
          next: '5.06',
        },
        {
          id: 'leave',
          label: 'Leave it there',
          reply: ['You go to bed without reading it.'],
          next: '5.06',
        },
      ],
    },
    '5.06': {
      kind: 'choice',
      ...beats,
      body: [
        'In the morning your bag is on the chair. You always leave the zipper open. It’s closed.',
        'Inside, the pages of your draft are in the wrong order.',
      ],
      options: [
        {
          id: 'asked',
          label: 'Ask Sam about it.',
          sets: ['bag=asked'],
          reply: [
            '“I was looking for the car keys,” Sam says.',
            'The car keys are on the hook. They are always on the hook.',
          ],
          next: '5.06b',
        },
        {
          id: 'checked',
          label: 'Check that nothing is missing.',
          sets: ['bag=checked'],
          reply: ['Nothing is missing. You check again on the train.'],
          next: '5.06b',
        },
        {
          id: 'silent',
          label: 'Say nothing.',
          sets: ['bag=silent'],
          reply: ['You put it on your shoulder and go.'],
          next: '5.06b',
        },
      ],
    },
    '5.06b': {
      kind: 'choice',
      ...beats,
      agitation: 0,
      mood: 'fight',
      body: [
        'That evening Sam is at the kitchen table. Your draft is in front of her.',
        'Sam’s own files are usually a mess. These pages are squared off perfectly.',
        {
          when: { flag: 'bag=asked' },
          text: '“I lied. I wasn’t looking for the keys,” she says.',
        },
        {
          when: { flag: 'bag=checked' },
          text: '“I know you checked,” she says. “Nothing was missing. I only read it.”',
        },
        {
          when: { flag: 'bag=silent' },
          text: '“You noticed,” she says. “You didn’t say anything.”',
        },
        {
          when: { flag: 'bill=design-rules' },
          text: '“There’s no age limit in it. Not sixteen. Not anything.”',
        },
        {
          when: { flag: 'bill=age-proof-app' },
          text: '“There’s an age check in it, but no age limit. You let the platforms decide who’s old enough.”',
        },
        '“You wrote a bill that doesn’t do what I asked. How does this protect kids?”',
      ],
      options: [
        {
          id: 'bag',
          label: '“You went through my bag.”',
          reply: [
            '“You stopped telling me what’s in it,” she says. “So I looked.”',
          ],
          next: '5.06c',
        },
        {
          id: 'draft',
          label: '“It’s a draft.”',
          reply: ['“It has your name on it,” she says.'],
          next: '5.06c',
        },
        {
          id: 'asked',
          label: '“You could have asked me.”',
          reply: [
            '“Would you have shown me?” She waits. You take too long to answer.',
          ],
          next: '5.06c',
        },
      ],
    },
    '5.06c': {
      kind: 'choice',
      ...beats,
      agitation: 0.6,
      body: [
        '“I’m not angry that you disagree with the book,” Sam says.',
        '“I’m angry that I found out by going through your bag.”',
      ],
      options: [
        {
          id: 'sorry',
          label: '“I’m sorry.”',
          reply: ['“I know,” she says. “That’s not the same as telling me.”'],
          next: '5.06d',
        },
        {
          id: 'another-fight',
          label: '“I didn’t want another fight.”',
          reply: ['“We’re having it anyway,” she says.'],
          next: '5.06d',
        },
        {
          id: 'no-right',
          label: '“You had no right to go through my things.”',
          reply: [
            '“I used to read every draft,” she says. “You used to ask me to.”',
          ],
          next: '5.06d',
        },
      ],
    },
    '5.06d': {
      kind: 'scene',
      ...beats,
      agitation: 0.6,
      hold: 0.6,
      body: ['She goes to the bedroom.', 'The door closes behind her.'],
      button: 'Watch it close',
      next: '5.07',
    },
    '5.07': {
      kind: 'choice',
      ...beats,
      mood: 'drabDark',
      body: [
        'It’s midnight. You’re still in the kitchen.',
        'The bedroom door is closed.',
      ],
      options: [
        {
          id: 'open-it',
          label: 'Open it',
          reply: [
            'You put your hand on the handle. You can hear her breathing on the other side, slow.',
            'You know which side of the bed she’s on. You know how warm it is.',
            'If you got in now, you would lie a hand’s width apart and not touch. You couldn’t stand that.',
            'You let go.',
          ],
          next: '5.07b',
        },
        {
          id: 'guest-room',
          label: 'Sleep in the guest room.',
          sets: ['sleep=guest-room'],
          next: '5.07g',
        },
        {
          id: 'office',
          label: 'Go back to the office.',
          sets: ['sleep=office'],
          next: '5.07o',
        },
      ],
    },
    '5.07b': {
      kind: 'choice',
      ...beats,
      body: [
        'It’s midnight. You’re still in the kitchen.',
        'The bedroom door is closed.',
      ],
      options: [
        {
          id: 'guest-room',
          label: 'Sleep in the guest room.',
          sets: ['sleep=guest-room'],
          next: '5.07g',
        },
        {
          id: 'office',
          label: 'Go back to the office.',
          sets: ['sleep=office'],
          next: '5.07o',
        },
      ],
    },
    '5.07g': {
      kind: 'moment',
      ...beats,
      body: [
        'The guest bed has a quilt from Sam’s mother. It smells like the closet.',
        'Her pillow smells like Earl Grey and old case files. This one smells like nothing.',
        'In the morning you tell Sam you didn’t want to wake her.',
      ],
      button: 'Turn off the light',
      next: '5.08',
    },
    '5.07o': {
      kind: 'moment',
      ...beats,
      body: [
        'You sleep in your blouse. In the morning your hair has a crease from the armrest.',
        'Greg finds you at six. He doesn’t say anything.',
        'He brings you a coffee from the machine. It’s watery.',
      ],
      button: 'Drink the coffee',
      next: '5.08',
    },
    '5.08': {
      kind: 'scene',
      ...beats,
      label: 'October. 1 month to the election.',
      body: [
        {
          when: { flag: 'sleep=guest-room' },
          text: 'By October your toothbrush lives in the guest bathroom. You take your makeup off with the hand soap by the sink. Your skin feels tight every morning.',
        },
        {
          when: { flag: 'sleep=office' },
          text: 'By October you keep a toothbrush in your desk drawer. You scrub yesterday’s foundation off with paper towels from the hallway bathroom. Under the lights, your skin looks gray.',
        },
        'Sam doesn’t ask. You don’t explain.',
      ],
      button: 'Go to bed',
      next: [
        { when: { flag: 'sleep=guest-room' }, to: '5.09g' },
        { to: '5.09o' },
      ],
    },
    '5.09g': {
      kind: 'choice',
      ...beats,
      body: ['You look at the guest room door.'],
      options: [
        {
          id: 'open',
          label: 'Leave it open.',
          reply: ['In the morning it’s closed. You didn’t hear her.'],
          next: '5.10',
        },
        {
          id: 'closed',
          label: 'Close it.',
          reply: ['In the morning it’s still closed.'],
          next: '5.10',
        },
      ],
    },
    '5.09o': {
      kind: 'scene',
      ...beats,
      body: [
        'You leave your office door open.',
        'Greg closes it quietly on his way out.',
      ],
      button: 'Sleep',
      next: '5.10',
    },
    '5.10': {
      kind: 'choice',
      ...beats,
      mood: 'office',
      body: [
        'You lose weight without trying.',
        'In a staff meeting you laugh at something, and it comes out wrong.',
        'Afterward Dana asks if you’re okay.',
      ],
      options: [
        { id: 'fine', label: '“I’m fine.”', next: '5.10a' },
        { id: 'not-really', label: '“Not really.”', next: '5.10b' },
        {
          id: 'after-november',
          label: '“Ask me after November.”',
          next: '5.10c',
        },
      ],
    },
    '5.10a': {
      kind: 'moment',
      ...beats,
      body: ['“Okay,” she says. She doesn’t believe you.'],
      button: 'Go back to work',
      next: '6.01',
    },
    '5.10b': {
      kind: 'moment',
      ...beats,
      body: [
        'She sits down and waits. You don’t say anything else.',
        'She stays anyway.',
      ],
      button: 'Go back to work',
      next: '6.01',
    },
    '5.10c': {
      kind: 'moment',
      ...beats,
      body: ['“I will,” she says.'],
      button: 'Go back to work',
      next: '6.01',
    },

    // ---------------------------------------------------------------- chapter 6
    '6.01': {
      kind: 'choice',
      ...beats,
      mood: 'ballroom',
      label: 'November. Election night.',
      body: [
        'The party is in a hotel ballroom with a carpet the color of ketchup. Sam isn’t here.',
        'She texted at six: “Good luck.” With a period.',
      ],
      options: [
        {
          id: 'love-you',
          label: '“Thank you. Love you.”',
          reply: ['The message says Delivered. It stays that way.'],
          next: '6.02',
        },
        {
          id: 'wish',
          label: '“I wish you were here.”',
          reply: ['Three dots appear. Then they go away.'],
          next: '6.02',
        },
        {
          id: 'phone-away',
          label: 'Put the phone away',
          reply: ['You take it out again eleven times before nine.'],
          next: '6.02',
        },
      ],
    },
    '6.02': {
      kind: 'scene',
      ...slow,
      hold: 1.0,
      body: [
        'At 11:52 pm the race is called.',
        'David Wallis wins by 3,100 votes.',
      ],
      button: 'Look for Dana',
      next: '6.03',
    },
    '6.03': {
      kind: 'choice',
      ...beats,
      body: [
        'Dana reads you the exit polls. Voters ranked children online as their second most important issue. The environment came seventh.',
        {
          when: { flag: 'review-skipped' },
          text: 'The clip of Wallis reading out a gap in your bill has two million views.',
        },
        '“They thought you were soft on tech,” she says quietly.',
        '“I pushed you toward this bill. I’m sorry it cost you.”',
      ],
      options: [
        {
          id: 'again',
          label: '“I’d write it again.”',
          reply: ['“I know,” she says. “That’s why I worked for you.”'],
          next: '6.04',
        },
        {
          id: 'my-call',
          label: '“It was my call, not yours.”',
          reply: [
            '“It was,” she says. “It was the right one. It just didn’t win.”',
          ],
          next: '6.04',
        },
        {
          id: 'nothing',
          label: 'Say nothing',
          reply: ['She puts her hand on your shoulder and leaves it there.'],
          next: '6.04',
        },
      ],
    },
    '6.04': {
      kind: 'scene',
      ...beats,
      body: [
        'You call Wallis. He says “Tough night” like he’s reading the weather.',
        'You go on stage. You thank everyone by name.',
        'Greg is at the back, in a jacket. You’ve never seen him out of his coveralls. You thank him too.',
      ],
      button: 'Leave the stage',
      next: '6.05',
    },
    '6.05': {
      kind: 'choice',
      ...beats,
      mood: 'car',
      body: ['In the car, you hold your phone.'],
      options: [
        {
          id: 'call',
          label: 'Call Sam.',
          sets: ['called'],
          reply: [
            'It rings six times. Her voicemail says she’ll call you back.',
          ],
          next: '6.06',
        },
        { id: 'home', label: 'Drive home', next: '6.06' },
        {
          id: 'office',
          label: 'Drive to the office',
          reply: [
            'You get as far as the parking garage. It’s the last place you want to be.',
            'You sit there a while. Then you drive home.',
          ],
          next: '6.06',
        },
      ],
    },
    '6.06': {
      kind: 'scene',
      ...slow,
      mood: 'night',
      hold: 0.5,
      body: [
        [
          'The house is dark.',
          {
            when: { flag: 'called' },
            text: 'Sam’s phone is on the kitchen counter. The screen says 1 missed call. Your name.',
          },
        ],
        [
          'You don’t turn on the lights. Only the one over the stove is on.',
          {
            when: { flag: 'snack=chips' },
            text: 'On the counter under it: a bag of chips, rolled shut, half gone.',
          },
          {
            when: { flag: 'snack=gummy-bears' },
            text: 'On the counter under it: the gummy bears, open.',
          },
          {
            when: { flag: 'snack=cookies' },
            text: 'On the counter under it: an open box of the cookies Sam says she doesn’t like.',
          },
        ],
        'You sit down on the couch.',
      ],
      button: 'Lie down',
      next: '6.07',
    },
    '6.07': {
      kind: 'scene',
      ...slow,
      hold: 0.6,
      body: ['At first it’s one tear.', 'Then it isn’t.'],
      button: 'Curl into yourself',
      next: '6.08',
    },
    '6.08': {
      kind: 'scene',
      ...slow,
      hold: 0.6,
      body: [
        'Three years. Two campaigns.',
        'A drought bill that passed as a shadow of what it was meant to be.',
        'And now: one night.',
        'Wallis doesn’t care about kids. He doesn’t care about the reservoirs.',
      ],
      button: 'Cover your face',
      next: '6.09',
    },
    '6.09': {
      kind: 'scene',
      ...slow,
      buttonStyle: 'thought',
      hold: 0.7,
      body: [
        'You can’t remember the last time you cried like this.',
        'You must look like a child.',
      ],
      button: 'A child.',
      next: '6.10',
    },
    '6.10': {
      kind: 'scene',
      ...slow,
      hold: 0.8,
      body: [
        'You think about Sam. About {name}.',
        'The rain boots are still in the closet. A child who fit them would be starting school by now.',
        'You think about every time you said “after the election.”',
        'It’s after the election.',
      ],
      button: 'Close your eyes',
      next: '6.11',
    },
    '6.11': {
      kind: 'scene',
      ...slow,
      buttonStyle: 'thought',
      hold: 0.7,
      body: [
        'You breathe fast and unevenly.',
        'Your chin quivers as an endless stream of tears runs down your face.',
      ],
      button: 'I didn’t only lose tonight.',
      next: '6.12',
    },
    '6.12': {
      kind: 'scene',
      ...slow,
      buttonStyle: 'thought',
      mood: 'warm',
      touch: true,
      hold: 0.8,
      body: [
        'Suddenly, a warm hand wipes a tear off your chin.',
        'You gasp.',
        'A gold ring with a thin silver edge catches the light from the open kitchen door.',
        'She tucks a strand of hair behind your ear. Her hand brushing against your tear-stained cheek.',
      ],
      button: 'You didn’t hear her sit down.',
      next: '6.13',
    },
    '6.13': {
      kind: 'scene',
      pace: 'slow',
      body: [
        'It takes a few blinks before you can see her.',
        'The freckle on her left cheek. You haven’t been that close to her in months.',
        'Sam’s mouth is a straight line. Her eyes are not.',
      ],
      button: 'You look into her eyes.',
      next: '6.14',
    },
    '6.14': {
      kind: 'choice',
      pace: 'slow',
      body: [
        'They’re red at the edges. There’s no anger left in them.',
        'Only worry, and something softer under it that you had stopped expecting to see.',
        'You haven’t seen her look at you like this in months.',
      ],
      options: [
        { id: 'sorry', label: '“I’m sorry.”', next: '6.15' },
        { id: 'reach', label: 'Reach for her', next: '6.15' },
      ],
    },
    '6.15': {
      kind: 'scene',
      ...slow,
      mood: 'warmer',
      hold: 4,
      body: [
        'You sit up and fall into her.',
        '“I’m sorry,” you whisper. Your voice shakes. “I’m so sorry. I’m sorry.”',
        'She pulls you into her lap and holds on. She presses her lips into your hair.',
        'Your foreheads touch. Neither of you lets go.',
      ],
      button: 'You both stay',
      fadeOut: true,
      next: '7.01',
    },

    // ---------------------------------------------------------------- the law
    '7.01': {
      kind: 'ending',
      mood: 'booth',
      restoresLook: true,
      title: 'Your bill became law.',
      body: [
        {
          when: { flag: 'bill=age-proof-app' },
          text: 'The Age Proof Act requires social media services to check a user’s age with an age proof app. The app tells a service only whether the user is old enough.',
        },
        {
          when: { flag: 'bill=design-rules' },
          text: 'The Safer Design Act requires social media services to change their design for users under 16. It does not require ID checks.',
        },
        {
          when: { flag: 'review-skipped' },
          text: 'It went to a vote without outside review.',
        },
        {
          when: { not: { flag: 'review-skipped' } },
          text: 'A security researcher and a digital rights lawyer reviewed the draft before it went to a vote.',
        },
      ],
      cut: true,
    },
  },
})
