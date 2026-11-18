// The general word lists (SPL-4), weighted below the kiosk's own words. Their main job is to stop
// ordinary words being "corrected" into a kiosk word ("cart" is not "chart"). Common English words,
// and everyday Tamil and Hindi words (the kiosk's own content adds more of both). Lower case.

const ENGLISH = `
a able about above accept access account across act action add address after afternoon again against age ago agree ahead
air all allow almost alone along already also always am among amount an and angry animal another answer any anyone anything
anyway anywhere apart apple apply april area arm around arrive art as ask at attach august aunt available away baby back bad
bag bake ball bank bath be beautiful because become bed been before begin behind being believe below best better between big
bike bill bird birth birthday bit black blood blue board boat body book born borrow both bottle bottom box boy brain bread break
breakfast bring brother brown build bus business busy but buy by cake call came camera can cancel car card care carry case cash
cat catch cause change charge cheap child children choose church city class clean clear clinic clock close clothes cloud coffee
cold collect college colour color come common company complete computer contact continue cook cool copy corner correct cost could
count country course cousin cover cream credit cross cry cup current customer cut daily dance danger dark date daughter day dead
dear death december decide deliver dentist department deposit describe desk detail did die different difficult dinner direct
direction dirty discount do doctor does dog doing dollar done door double down draw dream dress drink drive drop dry during each
ear early earn easy eat egg eight either electric eleven else email empty end enjoy enough enter evening event ever every everyone
everything exam example except exercise expect expensive explain eye face fact fall family far farm fast father favourite favorite
february feel fever few field fill film find fine finger finish fire first fish five fix floor flower fly follow food foot for
forget form forward four free fresh friday friend from front fruit full fun funny game garden gas gave get gift girl give glad glass
go god going gold gone good got government grand great green group grow guess guest had hair half hand happen happy hard has hat
have he head health hear heart heavy hello help her here high him his history hold holiday home hope hospital hot hotel hour house
how hundred hungry hurt husband i ice idea if ill important in inside instead insurance into is it its january job join journey
july jump june just keep key kid kind kitchen know lady land language large last late later laugh learn least leave left leg less
lesson let letter library life light like line list listen little live loan local lock long look lose lost lot loud love low
lunch machine made mail main make man many march market married match matter may maybe me meal mean medicine meet meeting member
menu message met middle might milk mind minute miss mobile moment monday money month more morning most mother mouth move movie
much music must my name near need never new news next nice night nine no noise none noon nor normal north not note nothing notice
november now number nurse of off office often oil ok okay old on once one online only open or orange order other our out outside
over own page pain paper parent park part party pass passport past pay payment pen people per person phone photo pick picture
piece place plan plant play please plus pocket point police poor possible post pound power present pretty price print problem
program pull purse push put question quick quiet quite rain read ready real really reason receipt receive red remember rent repair
repeat reply report rest result return rice rich ride right ring river road room round rule run sad safe said salary sale same
saturday save saw say school sea seat second see seem sell send september service set seven several she shirt shoe shop short
should show shut sick side sign simple since sing sister sit six size sleep slow small smell smile snow so some someone something
sometimes son song soon sorry sound south speak special spend spoke sport spring staff stand start station stay step still stop
store story street student study subject such sugar summer sun sunday sure sweet swim table take talk tall taxi tea teach teacher
team tell temple ten test than thank thanks that the their them then there these they thing think third this those though thought
three through thursday ticket till time tired to today together told tomorrow tonight too took tooth top town train travel tree
trip true try tuesday turn twelve twenty two type uncle under understand until up upon us use useful usual very visit voice wait
wake walk wall want warm was wash watch water way we wear weather wednesday week weekend welcome well went were west what when
where which while white who whole why wife will win window winter wish with without woman word work world worry would write
wrong year yes yesterday yet you young your

according act activity actually admit adult advice afraid afford agent agency alarm alive allowance although amazing
ambulance angle annual anybody anymore anyhow apart apartment appear apply appointment approve argue arm army arrange arrest
article artist assist assistant attack attend attention attitude audience author average avoid award aware awful balance band
bar base basic basket battery beach bean bear beat bell belong belt bench beside bet beyond bin bite blame blank blind block
blow bone bonus border boring boss bother bowl brave breath bridge brief bright broke broken brush budget bug burn button cab
cabin cable calendar calm camp campus candle cap capital captain career careful carpet cart cartoon cash cause ceiling cell
centre center certain chain chair chairman chance chapter character charity chart chat check checklist cheek cheese chef
chemical chest chicken chief chip choice circle citizen civil claim clerk click client climb clinic coach coast coat code coin
collar colleague column comfort command comment commit committee community compare complain complaint concern concert condition
confirm confuse connect consider contract control conversation cooker corporate cotton couch council counter couple courage
court cow crash crazy create crime crisis crop crowd cruel culture curtain curve cushion custom cycle damage data deal debt
decent deep defend degree delay demand deny deposit design destroy develop device diet digital dinner disease dish dismiss
display distance district divide document dozen draft drawer drawing driver drug dust duty eager earth ease edge education
effect effort elder election elevator emergency employ employee employer encourage energy engine engineer entire entrance
envelope equal error escape essay estate even evidence exact excuse exit expert extra fail fair faith false fan fashion fault
fear feature fee female fence festival figure file final finance fit flag flat flight float flood fold folk forest fork former
fortune forum frame freeze fridge fuel fund furniture future gain gap gate gather gear general gentle gentleman gesture ghost
giant glove goal goods grade grain grass grocery ground guard guide guilty gun habit hall handle hang harm hate heat height
helmet hero hide hill hire hit hobby hole honest honey hook horse host housing huge human humour hunt hurry ignore image
imagine improve inch include income increase indeed industry inform injury innocent insect interest interview invite invoice
iron island issue item jacket jail jam jewel joke judge juice jury justice kick kill king kiss knee knife knock label labour
lack ladder lake lamp landlord lap laptop law lawyer lay lazy lead leader leaf lean leather lecture legal lend level lie lift
limit link lip liquid loss lucky luggage mad magazine mall manage manager map mark marriage mass master material meat media
medical mental mess metal method mile military mine minister mirror mix model modern monitor mood motor mountain mouse mud
murder muscle museum nail narrow nation natural nature neck needle neighbour neighbor nephew nerve net niece nobody nose novel
nut object obvious occasion ocean offer officer opinion option ordinary organise organize oven owner pack package pain paint
pair palace pan panel pants parcel pardon partner passenger path patient pattern peace pension pepper perfect period permit
pet petrol photograph pillow pilot pin pipe pity plain plan plane plastic plate platform plenty pocket poem poet poison pole
policy polite pool population position potato pot powder practice prayer prefer pregnant prepare press pressure pride priest
prince prison private prize process produce product professor profit project promise proof proper property protect proud
prove provide public pump punish pupil purpose queue quarter queen race radio rail raise range rank rate raw reach react
receipt recent recipe record recover reduce refuse region relation relative relax release religion rely remove repair replace
request rescue research reserve resident respect respond responsible restaurant review reward rid risk rob rock role roof root
rope rough route row royal rubbish rude ruin rush salt sample sand sauce scale scene schedule science score screen sea search
season secret secretary section security seed senior sense sentence separate series serious servant session settle sex shade
shadow shake shame shape share sharp sheet shelf shell shift ship shock shoot shoulder shout shower sight signal silence silk
silver sink skill skin skip skirt sky slip slot smoke snake soap social society sock sofa soft soil soldier solid solve somebody
someday somewhere soup source space spare speech speed spell spirit split spoon spot spread square stable stage stairs stamp
standard star state statement status steal steel stick stock stomach stone storm stove straight strange stranger strength
stress strict strike string strong struggle stuff stupid style success suck suffer suggest suit supply support suppose surface
surprise surround survey suspect swallow sweat sweep switch symbol system tablet tail tank tap target task taste tax tear
technology teenager temperature tent term terrible text theatre theory thick thief thin thread threat throat throw thumb tie
tight tin tiny tip title toilet tone tongue tool topic total touch tough tour towel tower toy track trade traffic tray treat
trial trick trouble truck trust truth tube tune twin uniform union unit university upset urban urgent valley value van vegetable
vehicle vendor version vet victim video view village violent visa volume vote wage waste wave weak wealth weapon weigh weight
wheel whisper wide wild wing wire wise witness wood wool worker worse worst worth wound wrap yard yell yellow youth zero zone
`;

const TAMIL = `
நான் நீ நீங்கள் அவர் அவள் அது இது எது என் என்ன எங்கே எப்போது ஏன் எப்படி யார் எவ்வளவு ஆம் இல்லை சரி வேண்டும் வேண்டாம்
நன்றி வணக்கம் இன்று நாளை நேற்று நேரம் நாள் வாரம் மாதம் வருடம் காலை மாலை இரவு வீடு பணம் பெயர் தண்ணீர் சாப்பாடு உதவி
மருத்துவர் மருத்துவமனை கடை வேலை பள்ளி அம்மா அப்பா குழந்தை நண்பர் கேள்வி பதில் சொல் பார் போ வா கொடு எடு திற மூடு
`;

const HINDI = `
मैं तुम आप वह यह क्या कहाँ कब क्यों कैसे कौन कितना हाँ नहीं ठीक चाहिए धन्यवाद नमस्ते आज कल समय दिन हफ़्ता महीना साल सुबह
शाम रात घर पैसा नाम पानी खाना मदद डॉक्टर अस्पताल दुकान काम स्कूल माँ पिता बच्चा दोस्त सवाल जवाब बताओ देखो जाओ आओ दो लो
खोलो बंद है हैं था की का के में से पर और भी
`;

export const GENERAL_WORDS: readonly string[] = [ENGLISH, TAMIL, HINDI].flatMap((list) => list.split(/\s+/).filter(Boolean));
